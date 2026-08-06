"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { useFcmRegistration } from "@/lib/fcm";
import {
  Card,
  OptRow,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  Tag,
} from "@/components/primitives";
import type { Alert, Trip, TripLocation } from "@/lib/types";

const MIN_INSERT_GAP_MS = 8_000;
const MIN_INSERT_DISTANCE_M = 15;
const STOPPED_THRESHOLD_MS = 60_000; // 60 s

type GpsState = { lat: number; lng: number; at: string } | null;

function haversine(a: GpsState, b: GpsState): number {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Speed categories for the telemetry badge. */
interface SpeedBadge {
  cls: string;
  txt: string;
  color: string;
  bg: string;
}

function classifySpeed(kmh: number | null): SpeedBadge | null {
  if (kmh === null) return null;
  if (kmh <= 2) return { cls: "stopped", txt: "Stationary", color: "#A0A0A0", bg: "#F0F0F0" };
  if (kmh <= 7) return { cls: "walking", txt: `⚡ ${kmh.toFixed(1)} km/h — Walking`, color: "#388E3C", bg: "#E8F5E9" };
  if (kmh <= 15) return { cls: "active", txt: `⚡ ${kmh.toFixed(1)} km/h — Cycling / Running`, color: "#F57C00", bg: "#FFF3E0" };
  return { cls: "vehicle", txt: `⚡ ${kmh.toFixed(1)} km/h — In Vehicle / Bus`, color: "#1565C0", bg: "#E3F2FD" };
}

/** Threat banner driven by speed + stop duration. */
function threatBanner(speedKmh: number | null, stoppedMs: number | null): string | null {
  if (speedKmh === null) return null;
  if (speedKmh === 0 && stoppedMs !== null && stoppedMs > STOPPED_THRESHOLD_MS)
    return "⚠️ Caution: Movement stopped for over 60s in an unlit section. Checking in…";
  if (speedKmh > 15) return "In transit. Sharing real-time route telemetry with Safety Circle.";
  return "On schedule. Bright route ahead.";
}

/** Compute km/h from two GPS points and a time delta (ms). Returns null when inputs are invalid. */
function speedFromPoints(a: GpsState, b: GpsState, deltaMs: number): number | null {
  if (!a || !b || deltaMs <= 0) return null;
  const distM = haversine(a, b);
  return (distM / deltaMs) * 3600;
}

/** Remaining distance in km from current GPS to trip destination. */
function remainingKm(current: GpsState, destLat: number | null, destLng: number | null): number | null {
  if (!current || destLat == null || destLng == null) return null;
  return haversine(current, { lat: destLat, lng: destLng, at: "" }) / 1000;
}

/** Dynamic ETA in minutes based on current speed and remaining distance. */
function dynamicEta(speedKmh: number | null, remKm: number | null): number | null {
  if (speedKmh == null || remKm == null || remKm <= 0 || speedKmh <= 0.1) return null;
  return Math.round((remKm / speedKmh) * 60);
}

/** Normalize a lat/lng trail into map-box pixel coordinates (SVG space). */
function trailToSvg(trail: TripLocation[], w: number, h: number) {
  if (trail.length === 0) return { pts: "", start: null, end: null };
  const lats = trail.map((t) => t.lat);
  const lngs = trail.map((t) => t.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (maxLat - minLat < 0.0004) {
    minLat -= 0.0002;
    maxLat += 0.0002;
  }
  if (maxLng - minLng < 0.0004) {
    minLng -= 0.0002;
    maxLng += 0.0002;
  }
  const px = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * w;
  const py = (lat: number) => h - ((lat - minLat) / (maxLat - minLat)) * h;
  const pts = trail.map((t) => `${px(t.lng).toFixed(1)},${py(t.lat).toFixed(1)}`).join(" ");
  return {
    pts,
    start: { x: px(trail[0].lng), y: py(trail[0].lat) },
    end: { x: px(trail[trail.length - 1].lng), y: py(trail[trail.length - 1].lat) },
  };
}

function LiveScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const tripId = params.get("trip") ?? "";
  const supabase = getSupabaseBrowser();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<TripLocation[]>([]);
  const [gps, setGps] = useState<GpsState>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [contactCount, setContactCount] = useState(0);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);

  // ── Telemetry state (Feature 1) ──────────────────────────
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);

  // ── Demo mode state (Feature 2) ──────────────────────────
  const [demoMode, setDemoMode] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState<number | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  // ── Threat banner state (Feature 3) ──────────────────────
  const [stoppedSince, setStoppedSince] = useState<number | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const watchId = useRef<number | null>(null);
  const lastInsert = useRef<{ at: number; pos: GpsState }>({ at: 0, pos: null });
  const prevGpsRef = useRef<GpsState>(null);
  const prevGpsAtRef = useRef<number>(0);

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
            toast("Marked as arrived — journey ended");
            router.push("/");
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

  /* ── Real GPS: watchPosition + writes to trip_locations ── */
  useEffect(() => {
    if (!tripId || !navigator.geolocation) {
      setGpsError("Geolocation is not available on this device");
      return;
    }

    const insertPosition = (pos: GeolocationPosition) => {
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: new Date().toISOString() };
      setGps(point);

      // ── Speed telemetry ──────────────────────────────
      let kmh: number | null = null;
      if (pos.coords.speed != null && pos.coords.speed >= 0) {
        kmh = pos.coords.speed * 3.6; // m/s → km/h
      } else {
        const prev = prevGpsRef.current;
        const prevAt = prevGpsAtRef.current;
        if (prev) {
          const deltaMs = Date.now() - prevAt;
          if (deltaMs > 0) {
            kmh = speedFromPoints(prev, point, deltaMs);
          }
        }
      }
      setSpeedKmh(kmh);
      prevGpsRef.current = point;
      prevGpsAtRef.current = Date.now();

      // ── Trail insert (unchanged) ────────────────────
      const gap = Date.now() - lastInsert.current.at;
      const dist = haversine(lastInsert.current.pos, point);
      if (gap < MIN_INSERT_GAP_MS && dist < MIN_INSERT_DISTANCE_M) return;
      lastInsert.current = { at: Date.now(), pos: point };
      supabase
        .from("trip_locations")
        .insert({ trip_id: tripId, lat: point.lat, lng: point.lng })
        .then(({ error }) => {
          if (error) console.error("location insert failed", error.message);
        });
    };

    const onError = (err: GeolocationPositionError) => {
      setGpsError(err.message);
      setGps(null);
    };

    watchId.current = navigator.geolocation.watchPosition(
      insertPosition,
      onError,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [tripId, supabase]);

  /* ── Threat banner (Feature 3): reacts to speed + stop duration ── */
  useEffect(() => {
    const effectiveKmh = demoMode && demoSpeed != null ? demoSpeed : speedKmh;
    if (effectiveKmh === null) { setBannerMsg(null); setStoppedSince(null); return; }

    if (effectiveKmh === 0) {
      setStoppedSince((prev) => (prev ?? Date.now()));
    } else {
      setStoppedSince(null);
    }

    const stoppedMs = stoppedSince !== null ? Date.now() - stoppedSince : null;
    setBannerMsg(threatBanner(effectiveKmh, stoppedMs));
  }, [speedKmh, demoMode, demoSpeed, stoppedSince]);

  /* ── Dynamic ETA recalculation (Feature 1) ───────────────── */
  const remKm = useMemo(
    () => remainingKm(gps, trip?.destination_lat ?? null, trip?.destination_lng ?? null),
    [gps, trip]
  );
  const effectiveSpeedKmh = demoMode && demoSpeed != null ? demoSpeed : speedKmh;
  const dynamicEtaMin = useMemo(
    () => dynamicEta(effectiveSpeedKmh, remKm),
    [effectiveSpeedKmh, remKm]
  );
  const activeAlert = alerts.find((a) => a.status !== "resolved");
  const baseEtaMin = trip
    ? Math.max(0, Math.round((new Date(trip.expected_arrival_at).getTime() - Date.now()) / 60000))
    : null;
  const remainingMin = dynamicEtaMin ?? baseEtaMin;

  const speedBadge = classifySpeed(effectiveSpeedKmh);

  const svg = useMemo(() => trailToSvg(trail, 300, 240), [trail]);

  /* ── Actions ── */

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

  const arrived = useCallback(async () => {
    setCheckInOpen(false);
    await supabase.from("trips").update({ status: "arrived" }).eq("id", tripId);
  }, [supabase, tripId]);

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
          className="rounded-[20px] bg-primary2 px-3 py-2 text-xs font-bold text-primary"
        >
          I&apos;ve arrived
        </button>
      </div>

       <div className="map">
         <svg
           viewBox="0 0 300 240"
           preserveAspectRatio="none"
           className="absolute inset-0 h-full w-full"
         >
           {trail.length > 1 && (
             <polyline
               points={svg.pts}
               fill="none"
               stroke="var(--primary)"
               strokeWidth="4"
               strokeLinecap="round"
               strokeLinejoin="round"
               strokeOpacity="0.75"
             />
           )}
           {trail.length >= 2 && svg.start && (
             <circle cx={svg.start.x} cy={svg.start.y} r="7" fill="var(--card)" stroke="var(--primary)" strokeWidth="3" />
           )}
           {trail.length >= 1 && svg.end && (
             <circle cx={svg.end.x} cy={svg.end.y} r="9" fill="var(--accent)" stroke="var(--card)" strokeWidth="3" />
           )}
         </svg>

         {/* ── Live speed telemetry badge ─────────────────── */}
         {speedBadge && (
           <div
             className="mapbadge"
             style={{ background: speedBadge.bg, color: speedBadge.color, border: `1px solid ${speedBadge.color}33` }}
           >
             {speedBadge.txt}
           </div>
         )}

         <div className="livebar">
           <div>
             <b>{gpsError ? "Location unavailable" : "All good"}</b>
             <br />
             <small className="text-muted">
               {trip.destination_text}
               {remainingMin !== null && ` · ${remainingMin} min remaining`}
             </small>
           </div>
           <Tag>{trip.transit_mode}</Tag>
         </div>
       </div>

       {/* ── Threat / alert banner (Feature 3) ──────────── */}
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
          {gpsError ? (
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
        <PrimaryButton onClick={arrived}>I&apos;ve arrived</PrimaryButton>
        <SecondaryButton className="mt-2.5 w-full" onClick={() => { setCheckInOpen(false); setChoiceOpen(true); }}>
          Something feels off
        </SecondaryButton>
       </Sheet>

       {/* ── Demo Controls floating button (Feature 2) ── */}
       <button
         type="button"
         aria-label="Demo controls"
         onClick={() => setDemoOpen(true)}
         className="fixed bottom-6 right-6 z-50 grid h-[46px] w-[46px] place-items-center rounded-full bg-card shadow-card text-lg"
         style={{ opacity: 0.7 }}
       >
         🎭
       </button>

       <Sheet open={demoOpen} onClose={() => setDemoOpen(false)}>
         <div className="illus">🎭</div>
         <div className="eyebrow">Demo Controls</div>
         <h2 className="font-display mt-1.5 text-xl">Judge Simulation</h2>
         <p className="mb-4 mt-2 text-sm leading-[1.6] text-muted">
           Override live GPS speed to demo Sentinel&apos;s reactivity for judges.
           Toggle a preset below — the speed badge, ETA, and threat banner update instantly.
         </p>

         <div className="mb-3 flex items-center justify-between">
           <b className="text-sm">Mode</b>
           <button
             type="button"
             onClick={() => { setDemoMode(false); setDemoSpeed(null); }}
             className={`rounded-[20px] px-3 py-1.5 text-xs font-bold ${demoMode ? "bg-line text-muted" : "bg-primary2 text-primary"}`}
           >
             {demoMode ? "Demo Active" : "Real GPS"}
           </button>
         </div>

         {demoMode && (
           <div className="space-y-2">
             <p className="text-xs text-muted">Quick presets — tap to simulate:</p>
             <button
               type="button"
               onClick={() => setDemoSpeed(4.5)}
               className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
             >
               🚶 Walking Pace — <b>4.5 km/h</b>
             </button>
             <button
               type="button"
               onClick={() => setDemoSpeed(0)}
               className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
             >
               🛑 Sudden Stop — <b>0 km/h</b>
             </button>
             <button
               type="button"
               onClick={() => setDemoSpeed(32)}
               className="w-full rounded-[12px] border border-line bg-card px-3 py-3 text-left text-sm"
             >
               🚗 In Bus / Cab — <b>32 km/h</b>
             </button>
             {demoSpeed != null && (
               <button
                 type="button"
                 onClick={() => setDemoSpeed(null)}
                 className="w-full rounded-[12px] border border-line bg-card px-3 py-2 text-xs text-muted"
               >
                 Clear demo speed — back to GPS
               </button>
             )}
           </div>
         )}

         {!demoMode && (
           <button
             type="button"
             onClick={() => setDemoMode(true)}
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
