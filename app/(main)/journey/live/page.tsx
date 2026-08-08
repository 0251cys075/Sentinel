"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { useFcmRegistration } from "@/lib/fcm";
import { buildSosSmsDeepLink, isMobileDevice } from "@/lib/sos";
import {
  Card,
  OptRow,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  Tag,
} from "@/components/primitives";
import { SpeedBadge } from "@/components/speed-badge";
import { dynamicEtaMin, remainingKm } from "@/lib/telemetry";
import { useLiveTelemetry } from "@/lib/use-live-telemetry";
import { useOfflineRoute } from "@/lib/use-offline-route";
import { useStreetName } from "@/lib/use-street-name";
import type { Alert, Trip, TripLocation } from "@/lib/types";

const LiveNavMap = dynamic(() => import("@/components/live-nav-map").then((m) => m.LiveNavMap), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs text-muted">
      Loading map…
    </div>
  ),
});

const STOPPED_THRESHOLD_MS = 60_000; // 60 s
const DEMO_STOPPED_THRESHOLD_MS = 15_000; // punchy stop warning for judge demos

/** Threat banner driven by speed + stop duration. */
function threatBanner(speedKmh: number | null, stoppedMs: number | null, thresholdMs: number): string | null {
  if (speedKmh === null) return null;
  if (speedKmh === 0 && stoppedMs !== null && stoppedMs > thresholdMs)
    return `⚠️ Caution: Movement stopped for over ${Math.round(thresholdMs / 1000)}s in an unlit section. Checking in…`;
  if (speedKmh > 15) return "In transit. Sharing real-time route telemetry with Safety Circle.";
  return "On schedule. Bright route ahead.";
}

function LiveScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const tripId = params.get("trip") ?? "";
  const supabase = getSupabaseBrowser();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<TripLocation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [contactCount, setContactCount] = useState(0);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [arriving, setArriving] = useState(false);
  const arrivedRef = useRef(false);
  const prevQueuedRef = useRef(0);

  // ── Feature 1: live telemetry stream (GPS + speed + demo simulator) ──
  const tel = useLiveTelemetry({
    tripId: tripId || null,
    enabled: !!tripId,
    travelMode: trip?.transit_mode ?? "Walk",
  });

  /* ── Feature 3: offline breadcrumbs — GPS keeps recording to localStorage
     in dead zones; the `online` event/next fix bulk-syncs to Supabase. ── */
  const offline = useOfflineRoute({
    tripId: tripId || null,
    enabled: !!tripId && !tel.demoMode,
    travelMode: trip?.transit_mode ?? "Walk",
  });

  /* Local breadcrumbs feed the map trail too: while the device is offline
     the breadcrumb queue IS the trip (server trail is empty), so merge the
     queued points in, deduped by recorded_at and ordered chronologically.
     Once synced they arrive via Realtime and the merge stays idempotent. */
  const mapTrail = useMemo(() => {
    const seen = new Set(trail.map((t) => t.recorded_at));
    const merged = [
      ...trail.map((t) => ({ lat: t.lat, lng: t.lng, recorded_at: t.recorded_at })),
      ...offline.points
        .filter((p) => !seen.has(p.recorded_at))
        .map((p) => ({ lat: p.lat, lng: p.lng, recorded_at: p.recorded_at })),
    ];
    // Chronological so the polyline draws the walked path, not a zigzag.
    return merged
      .sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1))
      .map(({ lat, lng }) => ({ lat, lng }));
  }, [trail, offline.points]);

  /* Feature 3: announce a successful offline-route sync (queue drained). */
  useEffect(() => {
    if (prevQueuedRef.current > 0 && offline.queuedCount === 0) {
      toast(`Offline route synced — ${prevQueuedRef.current} breadcrumb${prevQueuedRef.current === 1 ? "" : "s"} uploaded`);
      prevQueuedRef.current = 0;
    } else if (offline.queuedCount > 0) {
      prevQueuedRef.current = offline.queuedCount;
    }
  }, [offline.queuedCount, toast]);

  // ── 📍 Nearby safety point: street / locality for the current fix ──
  const street = useStreetName(tel.gps?.lat ?? null, tel.gps?.lng ?? null);

  // ── Threat banner (reacts to speed + stop duration) ──
  const [stoppedSince, setStoppedSince] = useState<number | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  useFcmRegistration();

  /* ── Initial load: trip, trail, contacts ── */
  useEffect(() => {
    if (!tripId) return;
    supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single()
      .then(({ data }) => setTrip(data));
    supabase
      .from("trip_locations")
      .select("*")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: true })
      .limit(200)
      .then(({ data }) => setTrail(data ?? []));
    supabase
      .from("trusted_contacts")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setContactCount(count ?? 0));
  }, [tripId, supabase]);

  /* ── Realtime: locations, trips, alerts ── */
  useEffect(() => {
    if (!tripId) return;
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trip_locations", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          const row = payload.new as TripLocation;
          setTrail((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${tripId}` },
        (payload) => {
          const row = payload.new as Trip;
          setTrip(row);
          if (row.status === "arrived") {
            if (arrivedRef.current) return; // own completion — arrived() handles nav
            toast("Marked as arrived — journey ended");
            router.push("/?journey=completed");
          }
          if (row.status === "cancelled") {
            toast("Journey cancelled");
            router.push("/");
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          const row = payload.new as Alert;
          setAlerts((prev) => [...prev.filter((a) => a.id !== row.id), row]);
          if (row.type === "nudge" || row.type === "alarm") setCheckInOpen(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, supabase, router, toast]);

  /* ── Threat banner: reacts to effective speed + stop duration ── */
  useEffect(() => {
    const kmh = tel.effectiveSpeedKmh;
    const threshold = tel.demoMode ? DEMO_STOPPED_THRESHOLD_MS : STOPPED_THRESHOLD_MS;
    if (kmh === null) {
      setBannerMsg(null);
      setStoppedSince(null);
      return;
    }
    if (kmh === 0) {
      setStoppedSince((prev) => prev ?? Date.now());
    } else {
      setStoppedSince(null);
    }
    const stoppedMs = stoppedSince !== null ? Date.now() - stoppedSince : null;
    setBannerMsg(threatBanner(kmh, stoppedMs, threshold));
  }, [tel.effectiveSpeedKmh, tel.demoMode, stoppedSince]);

  /* ── ⏱️ Dynamic ETA from current speed + remaining distance ── */
  const remKm = useMemo(
    () => remainingKm(tel.gps, trip?.destination_lat ?? null, trip?.destination_lng ?? null),
    [tel.gps, trip]
  );
  const liveEtaMin = useMemo(
    () => dynamicEtaMin(tel.effectiveSpeedKmh, remKm),
    [tel.effectiveSpeedKmh, remKm]
  );
  const activeAlert = alerts.find((a) => a.status !== "resolved");
  const baseEtaMin = useMemo(() => {
    if (!trip) return null;
    const arrival = new Date(trip.expected_arrival_at).getTime();
    // Guard: null/invalid timestamps must never produce a huge fallback ETA.
    if (!trip.expected_arrival_at || Number.isNaN(arrival)) return null;
    const mins = Math.round((arrival - Date.now()) / 60000);
    if (!Number.isFinite(mins)) return null;
    return Math.max(0, Math.min(mins, 1440)); // never exceed 24h, never negative
  }, [trip]);
  const remainingMin = liveEtaMin ?? baseEtaMin;

  const destination =
    trip?.destination_lat != null && trip?.destination_lng != null
      ? { lat: trip.destination_lat, lng: trip.destination_lng }
      : null;

  /* ── Actions ── */
  const keepEye = useCallback(async () => {
    setChoiceOpen(false);
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    await supabase.from("alerts").insert({
      trip_id: tripId,
      user_id: user.id,
      type: "contact_notify",
      status: "pending",
    });
    toast("Quiet alert sent to your circle — no SOS");
  }, [supabase, tripId, toast]);

  const snooze = useCallback(
    async (minutes: number) => {
      if (!trip) return;
      const next = new Date(new Date(trip.expected_arrival_at).getTime() + minutes * 60000).toISOString();
      await supabase.from("trips").update({ expected_arrival_at: next }).eq("id", tripId);
      if (activeAlert) {
        await supabase
          .from("alerts")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", activeAlert.id);
      }
      setCheckInOpen(false);
      toast(`Snoozed for ${minutes} min — next check-in delayed`);
    },
    [trip, supabase, tripId, activeAlert, toast]
  );

  /* ── Bug 2: "I've arrived" — complete trip, revoke guest links, notify
     trusted contacts (push alert + native SMS), redirect with banner. ── */

  /** Compose + dispatch the native arrival SMS to the first primary contact. */
  const dispatchArrivalSms = useCallback(async () => {
    const destination = trip?.destination_text ?? "my destination";
    const arrivalMsg = encodeURIComponent(`SAFE ARRIVAL: I have arrived safely at ${destination}.`);

    const { data: primary } = await supabase
      .from("trusted_contacts")
      .select("name, phone")
      .eq("tier", "primary")
      .eq("verified", true)
      .limit(1);
    const contactPhone = primary?.[0]?.phone ?? "";
    if (!contactPhone) {
      toast("No primary contact with a phone — arrival shared via app alerts");
      return;
    }

    const smsUri = buildSosSmsDeepLink(contactPhone, arrivalMsg);
    if (!smsUri) {
      toast("Could not build arrival SMS link");
      return;
    }

    // Native SMS composer on phones; clipboard fallback on desktop.
    if (isMobileDevice(navigator.userAgent)) {
      window.location.href = smsUri;
    } else {
      try {
        await navigator.clipboard.writeText(
          `SAFE ARRIVAL: I have arrived safely at ${destination}.`
        );
        toast("Arrival SMS copied — paste in your messaging app");
      } catch {
        toast("Arrival notice ready — open your messaging app to send");
      }
    }
  }, [supabase, trip, toast]);

  const arrived = useCallback(async () => {
    if (arrivedRef.current || arriving) return;
    arrivedRef.current = true;
    setCheckInOpen(false);
    setArriving(true);
    try {
      // a) Mark the trip completed — realtime updates the UI + guest pages.
      const { error: tripError } = await supabase
        .from("trips")
        .update({ status: "arrived" })
        .eq("id", tripId);
      if (tripError) throw new Error(`Trip update failed: ${tripError.message}`);

      // b) Resolve open alerts + invalidate guest tokens so shared links
      //    stop working (get_public_* helpers require an un-resolved alert).
      const nowIso = new Date().toISOString();
      const { error: alertError } = await supabase
        .from("alerts")
        .update({
          status: "resolved",
          resolved_at: nowIso,
          guest_token: null,
          guest_token_expires_at: nowIso,
        })
        .eq("trip_id", tripId)
        .in("status", ["pending", "sent"]);
      if (alertError) console.error("resolving alerts on arrival failed:", alertError.message);

      // c) Arrival alert → the DB trigger pushes it to the trusted circle.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error: arrivedError } = await supabase.from("alerts").insert({
          trip_id: tripId,
          user_id: user.id,
          type: "arrived",
          status: "pending",
        });
        if (arrivedError) console.error("arrival alert insert failed:", arrivedError.message);
      }
    } catch (err) {
      arrivedRef.current = false;
      setArriving(false);
      toast(err instanceof Error ? err.message : "Could not complete journey — please retry");
      return;
    }

    // d) Native SMS to primary contact, then redirect home with a banner.
    try {
      await dispatchArrivalSms();
    } catch (err) {
      console.error("arrival SMS dispatch failed:", err);
      toast("Journey completed — arrival SMS could not be opened");
    }
    toast("Journey completed safely");
    router.push("/?journey=completed");
  }, [supabase, tripId, router, toast, dispatchArrivalSms, arriving]);

  const cancelJourney = useCallback(async () => {
    await supabase.from("trips").update({ status: "cancelled" }).eq("id", tripId);
    router.push("/");
  }, [supabase, tripId, router]);

  if (!trip) {
    return (
      <div className="pt-20 text-center">
        <span className="dot pulse" />
        <p className="mt-2 text-sm text-muted">Loading journey…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          aria-label="Close journey"
          onClick={cancelJourney}
          className="grid h-[42px] w-[42px] place-items-center rounded-full bg-card shadow-card"
        >
          ×
        </button>
        <div className="flex items-center gap-2">
          <span className="dot pulse" />
          <b>Live journey</b>
        </div>
        <button
          type="button"
          aria-label="Arrive"
          onClick={arrived}
          disabled={arriving}
          className="rounded-[20px] bg-primary2 px-3 py-2 text-xs font-bold text-primary disabled:opacity-60"
        >
          {arriving ? "Completing…" : "I&apos;ve arrived"}
        </button>
      </div>

      {/* ── Interactive map + live navigation bar (Feature 2) ───────── */}
      <div className="map">
        <LiveNavMap
          trail={mapTrail}
          user={tel.gps}
          destination={destination}
        />

        {/* ⚡ Current speed badge */}
        <SpeedBadge kmh={tel.effectiveSpeedKmh} className="mapbadge" />

        {/* 📍 Street / locality + ⏱️ live dynamic ETA */}
        <div className="livebar">
          <div className="min-w-0 pr-3">
            <b>{tel.gpsError ? "Location unavailable" : "Live navigation"}</b>
            <br />
            <small className="text-muted">
              {street ? `📍 ${street}` : trip.destination_text}
              {remainingMin !== null && ` · ⏱️ ${remainingMin} min remaining`}
            </small>
          </div>
          <Tag>{trip.transit_mode}</Tag>
        </div>
      </div>

      {/* ── Threat / alert banner ──────────────────────────────────── */}
      {bannerMsg && (
        <div
          className="mt-3 rounded-card border border-line bg-card p-3 text-sm leading-[1.5]"
          style={{
            borderColor: bannerMsg.startsWith("⚠") ? "#E53E3E44" : bannerMsg.startsWith("In transit") ? "#1565C044" : "#388E3C44",
            background: bannerMsg.startsWith("⚠") ? "#FDECEA" : bannerMsg.startsWith("In transit") ? "#E3F2FD" : "#E8F5E9",
          }}
        >
          {bannerMsg}
        </div>
      )}

      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="dot pulse" />
            <b>
              {activeAlert
                ? activeAlert.type === "alarm"
                  ? "Sentinel raised the alarm"
                  : "Sentinel is checking in"
                : "Sentinel is watching"}
            </b>
          </div>
          {tel.gpsError ? (
            <span className="text-xs font-bold text-accent">No GPS fix</span>
          ) : (
            <span className="text-muted">Live</span>
          )}
        </div>
        <p className="mt-1 text-xs leading-[1.5] text-muted">
          Location sharing is active with {contactCount} trusted contact{contactCount === 1 ? "" : "s"}.
          {activeAlert
            ? " An alert was raised for this journey — Sentinel is acting."
            : " No action needed."}
        </p>
        {offline.queuedCount > 0 && (
          <p className="mt-2 rounded-[12px] bg-primary2 px-3 py-2 text-xs font-bold leading-[1.5] text-primary">
            📡 Offline: {offline.queuedCount} breadcrumb{offline.queuedCount === 1 ? "" : "s"} saved
            locally — they&apos;ll auto-sync when you&apos;re back online.
          </p>
        )}
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <SecondaryButton onClick={() => router.push("/journey/call")}>☎ Fake Call</SecondaryButton>
        <SecondaryButton onClick={() => setChoiceOpen(true)}>Something feels off</SecondaryButton>
      </div>

      <Sheet open={choiceOpen} onClose={() => setChoiceOpen(false)}>
        <div className="illus">🛡</div>
        <div className="eyebrow">We&apos;ve got you</div>
        <h2 className="font-display mt-1.5 text-xl">Something feels off</h2>
        <p className="mb-4 mt-2 text-sm leading-[1.6] text-muted">
          Tell Sentinel how you&apos;d like to respond — you can change your
          mind any time.
        </p>
        <OptRow emoji="👀" title="Keep an eye on me" sub="Quiet notice to your circle. No SOS, no alarm." onClick={keepEye} />
        <OptRow emoji="🆘" title="I need help now" danger sub="Send your live location and details to your trusted circle." onClick={() => { setChoiceOpen(false); router.push(`/sos?trip=${tripId}`); }} />
        <OptRow emoji="☎" title="Fake call me" sub="Trigger a believable incoming call so you can step away." onClick={() => { setChoiceOpen(false); router.push("/journey/call"); }} />
      </Sheet>

      <Sheet open={checkInOpen} onClose={() => setCheckInOpen(false)}>
        <div className="illus">☕</div>
        <div className="eyebrow">Sentinel check-in</div>
        <h2 className="font-display mt-1.5 text-xl">Still on your way?</h2>
        <p className="mb-4 mt-2 text-sm leading-[1.6] text-muted">
          {activeAlert?.type === "alarm"
            ? "Your journey is well past its expected arrival. Sentinel has raised a loud alarm."
            : "We noticed your journey is taking a little longer than expected. No pressure — just checking in."}
        </p>
        <div className="mb-4 flex gap-2">
          <button type="button" className="rounded-[20px] border border-line bg-card px-3 py-2 text-xs" onClick={() => snooze(30)}>30 min</button>
          <button type="button" className="rounded-[20px] border border-line bg-card px-3 py-2 text-xs" onClick={() => snooze(60)}>1 hr</button>
          <button type="button" className="rounded-[20px] border border-line bg-card px-3 py-2 text-xs" onClick={() => snooze(180)}>4 hr</button>
        </div>
        <PrimaryButton onClick={arrived} disabled={arriving}>
          {arriving ? "Completing…" : "I&apos;ve arrived"}
        </PrimaryButton>
        <SecondaryButton className="mt-2.5 w-full" onClick={() => { setCheckInOpen(false); setChoiceOpen(true); }}>
          Something feels off
        </SecondaryButton>
      </Sheet>

      {/* ── Demo Telemetry toggle (Feature 2: judge presentation mode) ── */}
      <button
        type="button"
        aria-label="Demo telemetry controls"
        onClick={() => setDemoOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-full bg-card px-4 py-3 text-xs font-bold shadow-card"
        style={{ opacity: 0.8 }}
      >
        🎭 Demo Telemetry
        {tel.demoMode && (
          <span className="ml-0.5 rounded-full bg-primary2 px-2 py-0.5 text-[10px] text-primary">ON</span>
        )}
      </button>

      <Sheet open={demoOpen} onClose={() => setDemoOpen(false)}>
        <div className="illus">🎭</div>
        <div className="eyebrow">Demo Telemetry</div>
        <h2 className="font-display mt-1.5 text-xl">Judge Simulation</h2>
        <p className="mb-4 mt-2 text-sm leading-[1.6] text-muted">
          Simulate speed changes for indoor pitch presentations — the speed
          badge, ETA, threat banner and guest tracking page update instantly
          and sync to Supabase Realtime.
        </p>

        <div className="mb-3 flex items-center justify-between">
          <b className="text-sm">Mode</b>
          <button
            type="button"
            onClick={() => tel.setDemoMode(!tel.demoMode)}
            className={`rounded-[20px] px-3 py-1.5 text-xs font-bold ${tel.demoMode ? "bg-primary2 text-primary" : "bg-line text-muted"}`}
          >
            {tel.demoMode ? "Demo Active" : "Real GPS"}
          </button>
        </div>

        {tel.demoMode && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Quick presets — tap to simulate:</p>
            <button
              type="button"
              onClick={() => tel.setDemoSpeed(4.5)}
              className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
            >
              🚶 Walking Pace — <b>4.5 km/h</b>
            </button>
            <button
              type="button"
              onClick={() => tel.setDemoSpeed(0)}
              className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
            >
              🛑 Sudden Stop — <b>0 km/h</b>
            </button>
            <button
              type="button"
              onClick={() => tel.setDemoSpeed(32)}
              className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
            >
              🚗 In Bus / Cab — <b>32 km/h</b>
            </button>
            <button
              type="button"
              onClick={tel.runDemoSequence}
              disabled={tel.sequenceRunning}
              className="w-full rounded-[12px] bg-primary px-3 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {tel.sequenceRunning ? "▶ Running 0 → 4.5 → 32 km/h…" : "▶ Run demo sequence (0 → 4.5 → 32 km/h)"}
            </button>
          </div>
        )}

        {!tel.demoMode && (
          <button
            type="button"
            onClick={() => tel.setDemoMode(true)}
            className="mt-2 w-full rounded-[12px] bg-primary2 px-3 py-3 text-sm font-bold text-primary"
          >
            Enter Demo Mode
          </button>
        )}
      </Sheet>
    </div>
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<div className="pt-20 text-center text-sm text-muted">Loading…</div>}>
      <LiveScreen />
    </Suspense>
  );
}
