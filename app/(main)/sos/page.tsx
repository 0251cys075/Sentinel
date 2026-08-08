"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
    buildGuestTrackUrl,
    buildMapsLocationUrl,
    buildOfflineSosMessage,
    buildEmergencySmsMessage,
    buildSosMessage,
    buildSosSmsDeepLink,
    emergencySmsNumber,
    generateGuestToken,
    guestTokenExpiry,
    isMobileDevice,
    launchSmsUri,
    readLastKnownLocation,
  } from "@/lib/sos";
import { useToast } from "@/components/toast";
import { Card } from "@/components/primitives";
import { SpeedBadge } from "@/components/speed-badge";
import { useLiveTelemetry } from "@/lib/use-live-telemetry";
import { useOfflineRoute } from "@/lib/use-offline-route";
import { useStreetName } from "@/lib/use-street-name";
import { SOS_BURST_MS, stopSiren, triggerEmergencyAlarm } from "@/lib/siren";
import { useSentinelState } from "@/hooks/useSentinelState";

const SOS_COUNTDOWN_SECONDS = 8;

/**
 * Refreshed-mid-emergency resilience: the confirmed SOS screen (guest link,
 * SMS targets, live trip, offline flag) is snapshotted here under
 * `sentinel_sos_session` and rehydrated on mount, so a page reload can
 * never downgrade a confirmed "Help is on the way" back into a countdown.
 */
const SOS_SESSION_STORAGE_KEY = "sentinel_sos_session";

interface SosRestoreSession {
  confirmed?: boolean;
  guestUrl?: string;
  smsUris?: { name: string; uri: string }[];
  tripId?: string | null;
  offlineSms?: boolean;
}

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
  const { triggerSos, endSession } = useSentinelState();

  const [left, setLeft] = useState(SOS_COUNTDOWN_SECONDS);
  const [primaryContacts, setPrimaryContacts] = useState<PrimaryContact[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  /** True when the SOS went out via the offline SMS fallback (no network). */
  const [offlineSms, setOfflineSms] = useState(false);

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

  /** Feature 3: breadcrumbs keep recording during the emergency even in dead
      zones — they sync to trip_locations the moment a signal returns. */
  const offline = useOfflineRoute({
    tripId: streamTripId,
    enabled: !!streamTripId,
    travelMode: "Walk",
  });

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

  // Contacts load: hydrated from a localStorage cache first (survives offline
  // start), then refreshed from the API and re-cached so an offline SOS
  // always has numbers to message.
  const CONTACTS_CACHE_KEY = "sentinel_primary_contacts";
  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(CONTACTS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as PrimaryContact[];
        if (Array.isArray(parsed)) setPrimaryContacts(parsed);
      }
    } catch {
      /* corrupt cache — ignore */
    }
    void (async () => {
      try {
        const { data } = await getSupabaseBrowser()
          .from("trusted_contacts")
          .select("name, phone")
          .eq("tier", "primary")
          .eq("verified", true);
        const contacts = (data ?? []).map(
          (c) => ({ name: c.name, phone: c.phone }) as PrimaryContact
        );
        setPrimaryContacts(contacts);
        if (contacts.length) {
          try {
            window.localStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(contacts));
          } catch {
            /* storage full/blocked — ignore */
          }
        }
      } catch {
        /* offline — the cached contacts above keep the fallback alive */
      }
    })();
  }, []);

  /**
   * Snapshot the confirmed SOS to sessionStorage. Called on every success
   * path (online, offline SMS fallback and catch-path fallback) so a page
   * refresh mid-emergency can replay the exact confirmed screen.
   */
  const persistSosSession = useCallback(
    (
      info: { guestUrl: string; smsUris: { name: string; uri: string }[] },
      tripId: string | null,
      offlineSms: boolean
    ) => {
      const snapshot: SosRestoreSession = {
        confirmed: true,
        guestUrl: info.guestUrl,
        smsUris: info.smsUris,
        tripId,
        offlineSms,
      };
      try {
        window.sessionStorage.setItem(
          SOS_SESSION_STORAGE_KEY,
          JSON.stringify(snapshot)
        );
      } catch {
        /* storage blocked — in-memory session still runs */
      }
    },
    []
  );

  const clearSosSession = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SOS_SESSION_STORAGE_KEY);
    } catch {
      /* storage blocked — nothing to clean */
    }
  }, []);

  /**
   * Restore a confirmed SOS after a page refresh: replay the share links,
   * the offline flag and the live trip id, and jump straight to the
   * "Help is on the way" screen — never back into the 8-second countdown.
   * The snapshot is consumed on read so it can never replay twice.
   */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(SOS_SESSION_STORAGE_KEY);
    } catch {
      /* storage blocked — nothing to restore */
    }
    if (!raw) return;

    let saved: SosRestoreSession;
    try {
      saved = JSON.parse(raw) as SosRestoreSession;
    } catch {
      return; /* corrupt snapshot — ignore */
    }
    if (!saved.confirmed) return;

    doneRef.current = true;
    if (saved.tripId) setStreamTripId(saved.tripId);
    if (saved.offlineSms) setOfflineSms(true);
    setShareInfo({
      guestUrl: saved.guestUrl ?? "",
      smsUris: Array.isArray(saved.smsUris) ? saved.smsUris : [],
    });
    setConfirmed(true);
    toast("SOS session restored — help is still on the way.");
    clearSosSession();
  }, [toast, clearSosSession]);

  /* SPA-leave (back button etc.) ends the session for real; a hard page
     refresh skips this cleanup, which is exactly what lets the last
     snapshot survive the reload. */
  useEffect(() => () => {
    endSession();
    clearSosSession();
  }, [endSession, clearSosSession]);

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
   * Offline fallback: no network — and when upstream calls fail — the native
   * SMS composer is the only channel left. Reads the cached last-known fix
   * SYNCHRONOUSLY (no fresh geolocation call: a dead zone must never hang
   * the emergency on a satellite hunt), pre-fills `sms:` links for every
   * primary contact with a maps link, and returns true if any usable SMS
   * target exists.
   *
   * Guaranteed action: when no trusted contacts are cached, the SOS still
   * fires to the user's stored `emergency_contact` number (else 112) with
   * the exact "EMERGENCY! I need immediate help." message — a real, usable
   * SMS no matter what state the app is in.
   */
  const sendOfflineSms = useCallback(async (): Promise<{
    ok: boolean;
    smsUris: { name: string; uri: string }[];
  }> => {
    const cachedLoc = readLastKnownLocation();
    const locationUrl = cachedLoc
      ? buildMapsLocationUrl(cachedLoc.lat, cachedLoc.lng)
      : null;

    const contacts = primaryContactsRef.current;
    let smsUris = contacts
      .map((c) => ({
        name: c.name,
        uri: buildSosSmsDeepLink(c.phone, buildOfflineSosMessage(locationUrl)),
      }))
      .filter((u) => u.uri);

    if (!smsUris.length) {
      const emergencyNumber = emergencySmsNumber();
      const emergencyUri = buildSosSmsDeepLink(
        emergencyNumber,
        buildEmergencySmsMessage(locationUrl)
      );
      if (emergencyUri) {
        smsUris = [
          { name: `Emergency services (${emergencyNumber})`, uri: emergencyUri },
        ];
      }
    }
    if (!smsUris.length) return { ok: false, smsUris: [] };

    setShareInfo({ guestUrl: "", smsUris });
    return { ok: true, smsUris };
  }, []);

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
      // ── Offline path: no network at all — skip Supabase entirely and go
      //    straight to the native SMS composer. Identical hardware response
      //    to the online path: same alarm, same stop contract. ──
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const { ok, smsUris } = await sendOfflineSms();
        if (ok) {
          triggerEmergencyAlarm(SOS_BURST_MS);
          setOfflineSms(true);
          setConfirmed(true);
          persistSosSession({ guestUrl: "", smsUris }, null, true);
          triggerSos();
          return true;
        }
        doneRef.current = false;
        setSending(false);
        toast("Offline and no emergency contacts stored — reconnect or call a contact directly.");
        return false;
      }

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
      triggerEmergencyAlarm(SOS_BURST_MS);
      persistSosSession({ guestUrl: guestUrl ?? "", smsUris }, tripId, false);
      triggerSos();
      return true;
    } catch (err) {
      // API call failed (no network despite navigator.onLine, Supabase down,
      // insert rejected…) — degrade to the offline SMS composer instead of
      // leaving the user with nothing.
      const { ok, smsUris } = await sendOfflineSms();
      if (ok) {
        triggerEmergencyAlarm(SOS_BURST_MS);
        setOfflineSms(true);
        setConfirmed(true);
        persistSosSession({ guestUrl: "", smsUris }, null, true);
        triggerSos();
        return true;
      }
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
  }, [resolveTripId, sendOfflineSms, toast, persistSosSession, triggerSos]);

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
    stopSiren(); // alarm must die with the SOS the user just cancelled
    endSession(); // forget the session — a cancelled SOS restores nothing
    clearSosSession();
    toast("SOS cancelled — you're safe.");
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

  /* Feature 2: on phones, bounce straight into the SMS composer pre-filled
   * with the no-login guest link. Desktop keeps the on-screen buttons.
   * Offline fallback: open the composer on ANY device — the sms: link is
   * the only channel that still works without a network. */
  useEffect(() => {
    if (!confirmed || !shareInfo || smsFiredRef.current) return;
    smsFiredRef.current = true;
    if (!shareInfo.smsUris.length) return;

    if (offlineSms) {
      launchSmsUri(shareInfo.smsUris[0].uri);
      return;
    }
    if (!isMobileDevice(navigator.userAgent)) return;
    const t = setTimeout(() => {
      launchSmsUri(shareInfo.smsUris[0].uri);
    }, 1200);
    return () => clearTimeout(t);
  }, [confirmed, shareInfo, offlineSms]);

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
        <div className="eyebrow !text-primary">{offlineSms ? "SMS sent" : "SOS sent"}</div>
        <h1 className="font-display mt-2 text-[30px] font-bold leading-[1.15]">
          {offlineSms ? "SMS opened with your location" : "Help is on the way"}
        </h1>
        <p className="mt-3 leading-[1.6] text-muted">
          {offlineSms
            ? "You're offline — your SMS app has opened with your last known location. One tap and it goes out to your circle or emergency services."
            : smsTargets.length
              ? "Opening your SMS app for the first contact — one tap and the live tracking link goes out."
              : "Your trusted contacts have been notified with your location."}
        </p>

        {smsTargets.length > 0 && (
          <div className="mt-4 text-left">
            <div className="eyebrow mb-2">
              {offlineSms ? "Send location SMS" : "Send live tracking SMS"}
            </div>
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
        {!offlineSms && streamTripId && (
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
          {offline.queuedCount > 0 && (
            <p className="mt-2 text-xs font-bold text-primary">
              📡 {offline.queuedCount} breadcrumb{offline.queuedCount === 1 ? "" : "s"} saved
              locally — auto-syncing when signal returns.
            </p>
          )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            endSession();
            clearSosSession();
            router.push("/");
          }}
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