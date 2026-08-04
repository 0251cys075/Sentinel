import { publicBaseUrl, getServiceClient } from "../_shared/supabase.ts";
import { sendFcm, smsFallback, type FcmMessage } from "../_shared/fcm.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

/**
 * Fires whenever an alert row is inserted (via the DB trigger in
 * supabase/notifications_setup.sql, or directly over HTTP).
 *
 * Mapping (mirrors the spec):
 *   nudge / alarm        → push to the traveler (their own devices)
 *   contact_notify / sos → push to every trusted contact who has the app
 *                          and granted permission, with a track link
 * The SMS-fallback path is stubbed for providers like Twilio.
 */
Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const supabase = getServiceClient();
    const { alert_id } = (await req.json()) as { alert_id?: string };
    if (!alert_id) throw new Error("alert_id is required");

    const { data: alert, error: alertError } = await supabase
      .from("alerts")
      .select("*")
      .eq("id", alert_id)
      .single();
    if (alertError || !alert) throw alertError ?? new Error("alert not found");

    // Message copy per alert type.
    const copy: Record<string, { title: string; body: string }> = {
      nudge: {
        title: "Sentinel check-in",
        body: "Your journey is taking longer than expected. Open Sentinel to confirm you're okay.",
      },
      alarm: {
        title: "⚠ Loud alarm",
        body: "You're well past your expected arrival. Sentinel is watching closely.",
      },
      contact_notify: {
        title: "Can you check in?",
        body: "A journey shared with you has gone quiet. Tap to track it live.",
      },
      sos: {
        title: "🚨 SOS",
        body: "Someone you protect has triggered SOS. Open the live track now.",
      },
    };
    const { title, body } = copy[alert.type] ?? copy.nudge;
    const trackUrl = `${publicBaseUrl()}/track/${alert.trip_id ?? ""}`;
    const baseData: Record<string, string> = {
      trip_id: alert.trip_id ?? "",
      alert_id: alert.id,
      type: alert.type,
      url: trackUrl,
      title,
      body,
    };

    const { data: trip } = await supabase
      .from("trips")
      .select("destination_text, user_id")
      .eq("id", alert.trip_id)
      .maybeSingle();

    let recipients: { token: string; phone?: string | null }[] = [];

    if (alert.type === "contact_notify" || alert.type === "sos") {
      // Push to trusted contacts who have the app installed (account linked).
      const { data: contacts } = await supabase
        .from("trusted_contacts")
        .select("name, phone, account_id")
        .eq("user_id", trip?.user_id ?? alert.user_id);

      const linkedIds = (contacts ?? [])
        .filter((c) => c.account_id)
        .map((c) => c.account_id as string);

      const { data: tokens } = await supabase
        .from("fcm_tokens")
        .select("token")
        .in("user_id", linkedIds.length ? linkedIds : [""]);

      recipients = (tokens ?? []).map((t) => ({ token: t.token }));

      // App-less contacts → SMS fallback stub (not wired to Twilio).
      for (const contact of contacts ?? []) {
        if (!contact.account_id) {
          smsFallback(contact.phone, `${title} — ${body} ${trackUrl}`);
        }
      }
      // The sending user's own devices are always woken, too.
      const { data: ownerTokens } = await supabase
        .from("fcm_tokens")
        .select("token")
        .eq("user_id", alert.user_id);
      for (const t of ownerTokens ?? []) {
        if (!recipients.some((r) => r.token === t.token)) {
          recipients.push({ token: t.token });
        }
      }
    } else {
      // nudge / alarm → the traveler's own devices.
      const { data: tokens } = await supabase
        .from("fcm_tokens")
        .select("token")
        .eq("user_id", alert.user_id);
      recipients = (tokens ?? []).map((t) => ({ token: t.token }));
    }

    let succeeded = 0;
    const detail = `${trip?.destination_text ?? "a journey"} — ${trackUrl}`;
    for (const r of recipients) {
      const msg: FcmMessage = {
        token: r.token,
        title,
        body: `${body} ${detail}`,
        data: baseData,
        url: trackUrl,
      };
      if (await sendFcm(msg)) succeeded++;
    }

    await supabase
      .from("alerts")
      .update({ status: "sent" })
      .eq("id", alert.id);

    return new Response(
      JSON.stringify({ ok: true, alert: alert.type, recipients: recipients.length, delivered: succeeded }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});