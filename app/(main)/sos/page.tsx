"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  buildGuestTrackUrl,
  buildSosMessage,
  buildSosSmsDeepLink,
  generateGuestToken,
  guestTokenExpiry,
  isMobileDevice,
} from "@/lib/sos";
import { useToast } from "@/components/toast";
import { Card } from "@/components/primitives";
import { SpeedBadge } from "@/components/speed-badge";
import { useLiveTelemetry } from "@/lib/use-live-telemetry";
import { useStreetName } from "@/lib/use-street-name";

const SOS_COUNTDOWN_SECONDS = 8;

interface PrimaryContact {
  name: string;
  phone: string;
}

/** Absolute base for the guest link — env override when set, else live origin. */
function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location.origin) return window.location.origin;
  return "";
}

function SosScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const tripIdParam = params.get("trip") ?? "";

  const [left, setLeft] = useState(SOS_COUNTDOWN_SECONDS);
  const [primaryContacts, setPrimaryContacts] = useState<PrimaryContact[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  /** Trip being streamed live after SOS fires (see confirmSos). */
  const [streamTripId, setStreamTripId] = useState<string | null>(null);

  // ── Feature 1: high-accuracy GPS stream starts the instant SOS fires,
  //    broadcasting speed_kmh / heading / travel_mode to trip_locations so
  //    the no-login guest tracking page updates via Supabase Realtime. ──
  const tel = useLiveTelemetry({
    tripId: streamTripId,
    enabled: confirmed && !!streamTripId,
    travelMode: "Walk",
  });
  const sosStreet = useStreetName(tel.gps?.lat ?? null, tel.gps?.lng ?? null);

  /** What got handed out after a successful SOS (guest link + SMS targets). */
  const [shareInfo, setShareInfo] = useState<{
    guestUrl: string;
    smsUris: { name: string; uri: string }[];
  } | null>(null);

  const doneRef = useRef(false);
  const smsFiredRef = useRef(false);

  // Latest primary contacts reachable inside async closures without
  // re-creating `confirmSos` on every contacts fetch.
  const primaryContactsRef = useRef<PrimaryContact[]>([]);
  useEffect(() => {
    primaryContactsRef.current = primaryContacts;
  }, [primaryContacts]);

  useEffect(() => {
    getSupabaseBrowser()
      .from("trusted_contacts")
      .select("name, phone")
      .eq("tier", "primary")
      .eq("verified", true)
      .then(({ data }) =>
        setPrimaryContacts(
          (data ?? []).map((c) => ({ name: c.name, phone: c.phone }) as PrimaryContact)
        )
      );
  }, []);

  /**
   * Pick the trip the SOS alert attaches to: the one passed via ?trip=,
   * else the user's most recent trip (any status). If the user has no
   * trips at all, create a placeholder "Emergency" trip so the alert
   * always has a trip_id to reference.
   */
  const resolveTripId = useCallback(
    async (userId: string): Promise<string> => {
      if (tripIdParam) return tripIdParam;
      const supabase = getSupabaseBrowser();
      const { data: recent } = await supabase
        .from("trips")
        .select("id")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(1);
      if (recent && recent.length) return recent[0].id;

      const now = new Date().toISOString();
      const { data: placeholder, error: tripError } = await supabase
        .from("trips")
        .insert({
          user_id: userId,
          destination_text: "Emergency",
          transit_mode: "Walk",
          eta_minutes: 0,
          buffer_minutes: 0,
          status: "escalated",
          started_at: now,
          expected_arrival_at: now,
        })
        .select("id")
        .single();
      if (tripError) {
        console.error("Placeholder trip insert failed:", tripError);
        throw tripError;
      }
      return placeholder.id;
    },
    [tripIdParam]
  );

  /**
   * Insert the `sos` alert (with its public guest tracking token), hand the
   * tokenized link to the notification API, then compose the sms: deep links
   * for the primary contacts.
   */
  const confirmSos = useCallback(async (): Promise<boolean> => {
    if (doneRef.current) return false;
    doneRef.current = true;
    setSending(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // Mint the capability token BEFORE the insert so the alert row ships
      // with it in one atomic statement. Missing crypto degrades to no
      // guest link / no SMS — the SOS still goes out via email + push.
      const guestToken = generateGuestToken();
      const guestTokenExpiresAt = guestToken
        ? guestTokenExpiry()
        : null;

      const tripId = await resolveTripId(user.id);
      setStreamTripId(tripId); // start streaming live telemetry immediately
      const { data: alert, error } = await supabase
        .from("alerts")
        .insert({
          trip_id: tripId,
          user_id: user.id,
          type: "sos",
          status: "sent",
          created_at: new Date().toISOString(),
          guest_token: guestToken || null,
          guest_token_expires_at: guestTokenExpiresAt,
        })
        .select("id")
        .single();
      if (error) {
        console.error("SOS alert insert failed:", error);
        throw error;
      }

      // Public guest link — the ONLY thing contacts need to view live updates.
      const guestUrl = guestToken
        ? buildGuestTrackUrl(appBaseUrl(), alert.id, guestToken)
        : "";

      // Fire real notifications in the background — never block the success
      // screen on email/push delivery. Pass the canonical link so emails and
      // push open the same (tokenized) tracking page.
      void fetch("/api/sos-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, alertId: alert.id, trackUrl: guestUrl }),
      }).catch((err) => console.error("[sos-notify] background fetch failed:", err));

      // Compose the native SMS deep links for Feature 2. Missing phones or a
      // missing token are handled gracefully: we simply don't build URI(s).
      const smsUris: { name: string; uri: string }[] = [];
      if (guestUrl && primaryContactsRef.current.length) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();
        const message = buildSosMessage(profile?.full_name, guestUrl);
        for (const contact of primaryContactsRef.current) {
          const uri = buildSosSmsDeepLink(contact.phone, message);
          if (uri) smsUris.push({ name: contact.name, uri });
        }
      }

      setShareInfo({ guestUrl: guestUrl ?? "", smsUris });
      return true;
    } catch (err) {
      doneRef.current = false;
      setSending(false);
      console.error("SOS confirm failed:", err);
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string } | null)?.message ?? "unknown error";
      toast("SOS failed: " + message);
      return false;
    }
  }, [resolveTripId, toast]);

  /* Countdown — pure ticking, no side effects inside the state updater. */
  useEffect(() => {
    if (doneRef.current) return;
    const t = setInterval(() => {
      setLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Auto-fire the SOS the instant the countdown hits 00. */
  useEffect(() => {
    if (left > 0 || confirmed) return;
    void (async () => {
      const ok = await confirmSos();
      if (ok) setConfirmed(true);
    })();
    // Runs once per `left` transition; retries go through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const sendNow = useCallback(async () => {
    const ok = await confirmSos();
    if (ok) setConfirmed(true);
  }, [confirmSos]);

  const cancel = () => {
    if (doneRef.current || sending) return;
    doneRef.current = true;
    toast("SOS cancelled — you're safe.");
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

  /* Feature 2: on phones, bounce straight into the SMS composer pre-filled
   * with the no-login guest link. Desktop keeps the on-screen buttons. */
  useEffect(() => {
    if (!confirmed || !shareInfo || smsFiredRef.current) return;
    smsFiredRef.current = true;
    if (!isMobileDevice(navigator.userAgent) || !shareInfo.smsUris.length) return;
    const t = setTimeout(() => {
      window.location.href = shareInfo.smsUris[0].uri;
    }, 1200);
    return () => clearTimeout(t);
  }, [confirmed, shareInfo]);

  const copyGuestLink = async () => {
    if (!shareInfo?.guestUrl) return;
    try {
      await navigator.clipboard.writeText(shareInfo.guestUrl);
      toast("Tracking link copied");
    } catch {
      toast("Could not copy — send one of the sms: links instead");
    }
  };

  if (confirmed) {
    const smsTargets = shareInfo?.smsUris ?? [];
    return (
      <div className="sos">
        <div className="soscheck">
          <div>✓</div>
        </div>
        <div className="eyebrow !text-primary">SOS sent</div>
        <h1 className="font-display mt-2 text-[30px] font-bold leading-[1.15]">
          Help is on the way
        </h1>
        <p className="mt-3 leading-[1.6] text-muted">
          {smsTargets.length
            ? "Opening your SMS app for the first contact — one tap and the live tracking link goes out."
            : "Your trusted contacts have been notified with your location."}
        </p>

        {smsTargets.length > 0 && (
          <div className="mt-4 text-left">
            <div className="eyebrow mb-2">Send live tracking SMS</div>
            {smsTargets.map((t) => (
              <a
                key={t.uri}
                href={t.uri}
                className="mb-2 block w-full rounded-[13px] bg-primary2 px-4 py-[13px] text-center font-bold text-primary"
              >
                Open SMS for {t.name}
              </a>
            ))}
          </div>
        )}

        {shareInfo?.guestUrl && (
          <button
            type="button"
            onClick={copyGuestLink}
            className="mt-2.5 w-full rounded-[13px] bg-card px-4 py-[13px] font-bold text-primary"
          >
            Copy tracking link
          </button>
        )}

        {/* ── Live telemetry: GPS stream + speed broadcast to guests ── */}
        <div className="mt-4 rounded-[14px] border border-line bg-card p-4 text-left">
          <div className="flex items-center justify-between">
            <b className="text-sm">Live location sharing</b>
            <span className="dot pulse" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <SpeedBadge kmh={tel.effectiveSpeedKmh} />
            <span className="min-w-0 text-xs text-muted">
              {tel.gpsError
                ? "No GPS fix — retrying…"
                : tel.gps
                  ? `📍 ${sosStreet ?? `${tel.gps.lat.toFixed(5)}, ${tel.gps.lng.toFixed(5)}`}`
                  : "Acquiring GPS fix…"}
            </span>
          </div>
          {streamTripId && (
            <button
              type="button"
              onClick={() => router.push(`/journey/live?trip=${streamTripId}`)}
              className="mt-3 w-full rounded-[13px] bg-primary2 px-4 py-[13px] text-sm font-bold text-primary"
            >
              Open live journey map
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 w-full rounded-[15px] bg-primary px-[18px] py-4 font-bold text-white shadow-[0_10px_24px_rgba(15,110,86,0.18)]"
        >
          Return home
        </button>
      </div>
    );
  }

  const names = primaryContacts.length
    ? primaryContacts.map((c) => c.name).join(" and ")
    : "your trusted contacts";

  return (
    <div className="sos">
      <div className="sosring">
        <div>SOS</div>
      </div>
      <div className="eyebrow !text-danger">Ready to send</div>
      <h1 className="font-display mt-2 text-[30px] leading-[1.15]">
        Are you sure you need help?
      </h1>
      <p className="mt-3 leading-[1.6] text-muted">
        Sentinel will share your live location and journey details with {names}.
      </p>

      <Card className="my-3 text-left">
        <b>What will be sent</b>
        <p className="mt-1 text-xs leading-[1.6] text-muted">
          • Live location
          <br />• Last known route
          <br />• Emergency contact details
        </p>
      </Card>

      <button
        type="button"
        onClick={cancel}
        disabled={sending}
        className="w-full rounded-[15px] bg-danger px-[18px] py-4 font-bold text-white shadow-[0_0_0_2px_rgba(217,74,50,0.3)] disabled:opacity-60"
      >
        Cancel · {String(left).padStart(2, "0")}
      </button>
      <button
        type="button"
        onClick={sendNow}
        disabled={sending}
        className="mt-2.5 w-full rounded-[13px] bg-primary2 px-4 py-[13px] font-bold text-primary disabled:opacity-60"
      >
        {sending ? "Sending…" : "Send SOS now"}
      </button>
    </div>
  );
}

export default function SosPage() {
  return (
    <Suspense fallback={<div className="pt-20 text-center text-sm text-muted">Loading…</div>}>
      <SosScreen />
    </Suspense>
  );
}