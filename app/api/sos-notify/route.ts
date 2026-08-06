import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { getFirebaseMessaging } from "@/lib/firebase-admin";
import type { TrustedContact } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Extended function timeout — allows the fire-and-forget escalation email
 * (3 min after initial SOS) to run inside the same invocation.
 * Vercel Pro supports up to 300 s; Hobby is capped at 60 s so the escalation
 * will be silently skipped on Hobby plans — use a Supabase Edge Function cron
 * for a fully reliable alternative.
 */
export const maxDuration = 300;

/**
 * Resend's shared domain (onboarding@resend.dev) only delivers to your own
 * account inbox — so until a custom domain is verified in Resend, the
 * contact emails below will effectively only reach the logged-in user.
 * Set RESEND_FROM_EMAIL (e.g. 'sentinel@yourdomain.com') once verified.
 */
const RESEND_SHARED_FROM = "onboarding@resend.dev";

/** Delay before sending the escalating follow-up email (ms). */
const ESCALATION_DELAY_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Resolve the canonical tracking URL for an alert.
 *
 * 1. If SUPABASE_SERVICE_ROLE_KEY is set, read the alert's
 *    guest_token from the DB (service role bypasses RLS) and
 *    build the no-login /sos/track URL — this is the canonical,
 *    short-lived share link.
 * 2. Otherwise fall back to the token the client just minted
 *    (body.trackUrl), then to the legacy /track/alert page.
 */
async function resolveTrackUrl(
  alertId: string,
  clientTrackUrl: string | undefined
): Promise<string> {
  const adminClient = createServiceSupabase();
  if (adminClient) {
    const { data: alert, error } = await adminClient
      .from("alerts")
      .select("guest_token")
      .eq("id", alertId)
      .maybeSingle();

    if (error) {
      console.error("[sos-notify] guest_token fetch failed:", error);
    } else if (alert?.guest_token) {
      const base =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
      return `${base}/sos/track/${encodeURIComponent(alertId)}?token=${encodeURIComponent(alert.guest_token)}`;
    }
  }

  if (clientTrackUrl) return clientTrackUrl;

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
  return `${base}/track/alert/${encodeURIComponent(alertId)}`;
}

export async function POST(request: Request) {
  let body: { userId?: string; alertId?: string; trackUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { userId, alertId } = body;
  if (!userId || !alertId) {
    return NextResponse.json(
      { ok: false, error: "userId and alertId are required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const supabase = await createServerSupabase();

  // Only the account owner may trigger notifications for their contacts.
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (caller.id !== userId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const [profileRes, contactsRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase
      .from("trusted_contacts")
      .select("*")
      .eq("user_id", userId)
      .eq("tier", "primary")
      .eq("verified", true),
  ]);

  if (contactsRes.error) {
    console.error("[sos-notify] contacts fetch failed:", contactsRes.error);
    return NextResponse.json({ ok: false, error: contactsRes.error.message }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const fullName = profileRes.data?.full_name ?? "a Sentinel user";
  const contacts = (contactsRes.data ?? []) as TrustedContact[];
  const results: unknown[] = [];

  // Custom-domain sender falls back to Resend's shared account-only domain.
  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || RESEND_SHARED_FROM;

  // ─── Track link ───────────────────────────────────────────────────────
  // Prefer the DB-canonical guest token (fetched with the service-role key)
  // so links always point at the public, no-login /sos/track page. Falls
  // back to the token the client just minted, then to the legacy alert page.
  const trackUrl = await resolveTrackUrl(alertId, body.trackUrl);

  // ─── 1. Confirmation email to the user who triggered the SOS ───────────────
  if (caller.email) {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [caller.email],
      subject: "Your SOS alert was sent",
      text: "Your emergency contacts have been notified. Help is on the way.",
    });

    if (error) {
      console.error("[sos-notify] confirmation email failed:", error);
      results.push({ contact: "user", ok: false, detail: error.message });
    } else {
      console.log(`[sos-notify] confirmation emailed ${caller.email} (id=${data?.id})`);
      results.push({ contact: "user", ok: true, id: data?.id });
    }
  }

  // ─── 2. Emergency email to every verified primary contact ──────────────────
  for (const contact of contacts) {
    if (!contact.email) {
      console.log(`[sos-notify] skipping contact "${contact.name}": no email address`);
      results.push({ contact: contact.name, skipped: true, reason: "no email address" });
      continue;
    }

    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [contact.email],
      subject: "🚨 SENTINEL EMERGENCY ALERT",
      html:
        `<h2>Emergency Alert</h2>` +
        `<p><strong>${fullName}</strong> has triggered an SOS alert and may need immediate help. Please contact them now.</p>` +
        `<p><a href="${trackUrl}" style="display:inline-block;padding:12px 24px;background:#E53E3E;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">📍 See their location</a></p>`,
    });

    if (error) {
      console.error(`[sos-notify] email to ${contact.name} failed:`, error);
      results.push({ contact: contact.name, ok: false, detail: error.message });
    } else {
      console.log(`[sos-notify] emailed ${contact.name} <${contact.email}> (id=${data?.id})`);
      results.push({ contact: contact.name, ok: true, id: data?.id });
    }
  }

  // ─── 3. High-priority FCM push to contacts with a Sentinel account ─────────
  //
  // Flow:
  //   trusted_contacts.account_id → lookup fcm_tokens by user_id
  //   → send one high-priority FCM message per token.
  //
  // On Android this fires as a heads-up (peek) notification that overlays
  // whatever app is open and cannot be easily swiped away in notification shade.
  //
  // On iOS (web/PWA): iOS does not support Critical Alert entitlement for
  // browser-based push — the notification will appear in the notification
  // center at default priority. Critical Alerts require a native app with
  // the com.apple.developer.usernotifications.critical-alerts entitlement.
  const messaging = getFirebaseMessaging();
  const fcmResults: unknown[] = [];

  if (!messaging) {
    console.warn("[sos-notify] FCM messaging not configured — skipping push notifications");
    fcmResults.push({ skipped: true, reason: "Firebase Admin SDK not configured" });
  } else {
    // Collect account_ids for all primary contacts that have linked accounts.
    const accountIds = contacts
      .map((c) => c.account_id)
      .filter((id): id is string => !!id);

    if (accountIds.length === 0) {
      console.log("[sos-notify] no contacts have linked Sentinel accounts — no FCM pushes");
      fcmResults.push({ skipped: true, reason: "no linked contact accounts" });
    } else {
      // Use the service-role client so we can read tokens for other users
      // (their RLS policy only allows self-reads).
      const adminClient = createServiceSupabase();
      if (!adminClient) {
        console.warn("[sos-notify] SUPABASE_SERVICE_ROLE_KEY not set — cannot fetch FCM tokens");
        fcmResults.push({ skipped: true, reason: "service role key not configured" });
      } else {
        const { data: tokenRows, error: tokensError } = await adminClient
          .from("fcm_tokens")
          .select("token, user_id")
          .in("user_id", accountIds);

        if (tokensError) {
          console.error("[sos-notify] FCM token fetch failed:", tokensError);
          fcmResults.push({ ok: false, detail: tokensError.message });
        } else {
          const tokens = (tokenRows ?? []).map((r) => r.token as string);
          console.log(`[sos-notify] sending FCM push to ${tokens.length} device(s)`);

          for (const token of tokens) {
            try {
              const messageId = await messaging.send({
                token,
                notification: {
                  title: "🚨 EMERGENCY ALERT — Sentinel",
                  body: `${fullName} needs help immediately. Tap to see their location.`,
                },
                // High-priority delivery on Android — shows as heads-up notification.
                android: {
                  priority: "high",
                  notification: {
                    sound: "default",
                    channelId: "sos_alerts",
                    priority: "max",
                    defaultVibrateTimings: true,
                  },
                },
                // APNS (Apple Push Notification Service) for iOS / macOS.
                // NOTE: 'time-sensitive' is the highest interruption level
                // available to web apps. True Critical Alerts (sound even in
                // Do Not Disturb) require the native Critical Alerts entitlement
                // which is only granted to native iOS/macOS apps by Apple.
                apns: {
                  payload: {
                    aps: {
                      sound: "default",
                      badge: 1,
                      "interruption-level": "time-sensitive",
                    },
                  },
                },
                // Data payload — read by the service worker notification click
                // handler to open the correct (tokenized, no-login) track page.
                data: {
                  alertId,
                  userId,
                  type: "sos",
                  url: trackUrl,
                },
                // Web push (Chrome / Edge / Firefox on desktop).
                webpush: {
                  notification: {
                    title: "🚨 EMERGENCY ALERT — Sentinel",
                    body: `${fullName} needs help immediately. Tap to see their location.`,
                    icon: "/icon.svg",
                    badge: "/icon.svg",
                    requireInteraction: true,
                    // tag groups alerts so a second push replaces the first
                    // rather than stacking multiple notifications.
                    tag: `sos-${alertId}`,
                    data: { url: trackUrl },
                  },
                  fcmOptions: {
                    link: trackUrl,
                  },
                },
              });

              console.log(`[sos-notify] FCM sent to token …${token.slice(-8)} (id=${messageId})`);
              fcmResults.push({ token: token.slice(-8), ok: true, messageId });
            } catch (fcmErr) {
              const msg = fcmErr instanceof Error ? fcmErr.message : String(fcmErr);
              console.error(`[sos-notify] FCM send failed for token …${token.slice(-8)}:`, msg);
              fcmResults.push({ token: token.slice(-8), ok: false, detail: msg });
            }
          }
        }
      }
    }
  }

  // ─── 4. Escalating follow-up email (fire-and-forget, ~3 min later) ─────────
  //
  // We deliberately do NOT await this promise — the HTTP response is returned
  // immediately after scheduling the escalation. Node.js keeps the event loop
  // alive until the awaited setTimeout resolves, which is why maxDuration=300
  // is declared above. On Vercel Hobby (60 s max) the setTimeout will be
  // killed and the escalation email will never fire — use a Supabase Edge
  // Function cron (see supabase/functions/) for a reliable alternative.
  scheduleEscalationEmail({
    alertId,
    userId,
    fullName,
    contacts,
    fromAddress,
    apiKey,
    trackUrl,
    delayMs: ESCALATION_DELAY_MS,
  }).catch((err) => {
    console.error("[sos-notify] escalation email scheduler threw:", err);
  });

  return NextResponse.json({ ok: true, alertId, results, fcmResults });
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalation email helper
// ─────────────────────────────────────────────────────────────────────────────

interface EscalationParams {
  alertId: string;
  userId: string;
  fullName: string;
  contacts: TrustedContact[];
  fromAddress: string;
  apiKey: string;
  trackUrl: string;
  delayMs: number;
}

/**
 * Waits `delayMs` milliseconds, then re-checks the alert status via the
 * service-role key. If the alert is still in `'sent'` state (not yet
 * acknowledged by any contact), sends a follow-up urgent email.
 */
async function scheduleEscalationEmail(params: EscalationParams): Promise<void> {
  const { alertId, fullName, contacts, fromAddress, apiKey, trackUrl, delayMs } = params;

  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

  const adminClient = createServiceSupabase();
  if (!adminClient) {
    console.warn("[sos-notify/escalation] SUPABASE_SERVICE_ROLE_KEY not set — skipping");
    return;
  }

  // Re-fetch the alert status.
  const { data: alert, error } = await adminClient
    .from("alerts")
    .select("status")
    .eq("id", alertId)
    .maybeSingle();

  if (error) {
    console.error("[sos-notify/escalation] alert status fetch failed:", error);
    return;
  }

  if (!alert) {
    console.log("[sos-notify/escalation] alert not found — skipping follow-up");
    return;
  }

  // Only escalate if still in 'sent' state (not acknowledged / resolved).
  if (alert.status !== "sent") {
    console.log(
      `[sos-notify/escalation] alert status is '${alert.status}' — no follow-up needed`
    );
    return;
  }

  console.log("[sos-notify/escalation] alert still 'sent' after 3 min — sending follow-up emails");

  const resend = new Resend(apiKey);

  for (const contact of contacts) {
    if (!contact.email) continue;

    const { data, error: emailErr } = await resend.emails.send({
      from: fromAddress,
      to: [contact.email],
      subject: `⚠️ URGENT: ${fullName} still needs help — please respond`,
      html:
        `<h2 style="color:#E53E3E;">⚠️ Urgent Follow-up</h2>` +
        `<p><strong>${fullName}</strong> triggered an SOS alert 3 minutes ago and has not yet been reached.</p>` +
        `<p>Please check on them immediately.</p>` +
        `<p><a href="${trackUrl}" style="display:inline-block;padding:12px 24px;background:#E53E3E;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">📍 See their location now</a></p>`,
    });

    if (emailErr) {
      console.error(`[sos-notify/escalation] follow-up to ${contact.name} failed:`, emailErr);
    } else {
      console.log(`[sos-notify/escalation] follow-up emailed ${contact.name} (id=${data?.id})`);
    }
  }
}