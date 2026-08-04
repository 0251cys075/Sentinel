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

const STALE_AFTER_MS = 120_000;
const LIVE_AFTER_MS = 45_000;
const MIN_INSERT_GAP_MS = 8_000;
const MIN_INSERT_DISTANCE_M = 15;

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

function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
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

  const watchId = useRef<number | null>(null);
  const lastInsert = useRef<{ at: number; pos: GpsState }>({ at: 0, pos: null });

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

  /* ── Staleness from the REAL last recorded_at, like the prototype's badge ── */
  const now = useNow(5000);
  const lastFixAt = useMemo(() => {
    const real = trail[trail.length - 1]?.recorded_at;
    if (real) return new Date(real).getTime();
    return gps ? new Date(gps.at).getTime() : null;
  }, [trail, gps]);

  const ageMs = lastFixAt === null ? Infinity : now - lastFixAt;
  const badge =
    ageMs < LIVE_AFTER_MS
      ? { cls: "live", txt: "● GPS · Live now" }
      : ageMs < STALE_AFTER_MS
        ? { cls: "upd", txt: `● GPS · Updated ${Math.floor(ageMs / 60000)} min ago` }
        : { cls: "stale", txt: `● GPS · Stale — last seen ${Math.floor(ageMs / 60000)} min ago` };

  const activeAlert = alerts.find((a) => a.status !== "resolved");
  const remainingMin = trip
    ? Math.max(0, Math.round((new Date(trip.expected_arrival_at).getTime() - Date.now()) / 60000))
    : null;

  const svg = useMemo(() => trailToSvg(trail, 300, 240), [trail]);

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
        <div className={`mapbadge ${badge.cls}`}>{badge.txt}</div>
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
