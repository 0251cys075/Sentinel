"use client";

/**
 * Live telemetry stream: high-accuracy GPS watcher, speedometer with
 * haversine fallback, throttled Supabase inserts (speed_kmh / heading /
 * travel_mode) and the Demo Telemetry simulator for judge presentations.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  bearingDeg,
  DEMO_ROUTE,
  type GpsPoint,
  haversine,
  interpolate,
  speedFromPoints,
} from "@/lib/telemetry";

/** Preset speeds the demo sequence cycles through (0 → walk → vehicle). */
export const DEMO_SPEED_SEQUENCE = [0, 4.5, 32];
/** How long each demo speed step is held. */
export const DEMO_STEP_MS = 8_000;

const MIN_INSERT_GAP_MS = 8_000;
const MIN_INSERT_DISTANCE_M = 15;
const SIM_TICK_MS = 1_000;

interface DemoSim {
  idx: number;
  dir: 1 | -1;
  pos: GpsPoint;
}

function startOfDemo(): DemoSim {
  return { idx: 0, dir: 1, pos: { ...DEMO_ROUTE[0], at: new Date().toISOString() } };
}

export function useLiveTelemetry({
  tripId,
  enabled = true,
  travelMode = "Walk",
}: {
  tripId: string | null;
  enabled?: boolean;
  travelMode?: string;
}) {
  const [gps, setGps] = useState<GpsPoint | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [demoMode, setDemoModeState] = useState(false);
  const [demoSpeed, setDemoSpeedState] = useState<number | null>(null);
  const [sequenceRunning, setSequenceRunning] = useState(false);

  const watchId = useRef<number | null>(null);
  const lastInsert = useRef<{ at: number; pos: GpsPoint | null }>({ at: 0, pos: null });
  const prevGpsRef = useRef<GpsPoint | null>(null);
  const prevGpsAtRef = useRef(0);
  const travelModeRef = useRef(travelMode);
  const simRef = useRef<DemoSim | null>(null);
  const simHeadingRef = useRef<number | null>(null);
  const seqTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    travelModeRef.current = travelMode;
  }, [travelMode]);

  /** Publish a fix: update state and (throttled) write it to trip_locations. */
  const pushPoint = useCallback(
    (point: GpsPoint, kmh: number | null, h: number | null, force = false) => {
      setGps(point);
      setSpeedKmh(kmh);
      if (h != null) setHeading(h);

      const gap = Date.now() - lastInsert.current.at;
      const dist = haversine(lastInsert.current.pos, point);
      if (!force && gap < MIN_INSERT_GAP_MS && dist < MIN_INSERT_DISTANCE_M) return;
      if (!tripId) return;

      lastInsert.current = { at: Date.now(), pos: point };
      getSupabaseBrowser()
        .from("trip_locations")
        .insert({
          trip_id: tripId,
          lat: point.lat,
          lng: point.lng,
          speed_kmh: kmh,
          heading: h,
          travel_mode: travelModeRef.current,
        })
        .then(({ error }) => {
          if (error) console.error("location insert failed", error.message);
        });
    },
    [tripId]
  );

  /* ── Real GPS: navigator.geolocation.watchPosition (high accuracy) ── */
  useEffect(() => {
    if (!enabled || !tripId) return;
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not available on this device");
      return;
    }

    const onPosition = (pos: GeolocationPosition) => {
      if (simRef.current) return; // demo owns the stream while active
      const point: GpsPoint = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        at: new Date().toISOString(),
      };

      // Speed: device-reported m/s → km/h, else haversine over the last fix.
      let kmh: number | null = null;
      if (pos.coords.speed != null && pos.coords.speed >= 0) {
        kmh = pos.coords.speed * 3.6;
      } else if (prevGpsRef.current && prevGpsAtRef.current > 0) {
        kmh = speedFromPoints(prevGpsRef.current, point, Date.now() - prevGpsAtRef.current);
      }

      // Heading: device-reported, else bearing from the previous fix.
      const h =
        pos.coords.heading != null
          ? pos.coords.heading
          : prevGpsRef.current
            ? bearingDeg(prevGpsRef.current, point)
            : null;

      prevGpsRef.current = point;
      prevGpsAtRef.current = Date.now();
      pushPoint(point, kmh, h);
    };

    const onError = (err: GeolocationPositionError) => {
      setGpsError(err.message);
      setGps(null);
    };

    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [enabled, tripId, pushPoint]);

  /* ── Demo simulator: moves the marker along DEMO_ROUTE at demoSpeed ── */
  useEffect(() => {
    if (!demoMode) {
      simRef.current = null;
      simHeadingRef.current = null;
      setDemoSpeedState(null);
      return;
    }

    if (!simRef.current) {
      simRef.current = startOfDemo();
    }

    const speed = demoSpeed ?? 0;

    // Broadcast a speed/position change even while stationary so guests
    // immediately see the new speed via Realtime.
    if (simRef.current) pushPoint(simRef.current.pos, speed, simHeadingRef.current, true);

    if (speed <= 0) return;

    const t = setInterval(() => {
      const s = simRef.current;
      if (!s) return;
      const before = { ...s.pos };
      let remaining = (speed / 3.6) * (SIM_TICK_MS / 1000);
      let guard = 0;
      while (remaining > 0.0001 && guard < 100) {
        guard += 1;
        const next = s.idx + s.dir;
        if (next < 0 || next >= DEMO_ROUTE.length) {
          s.dir = (s.dir * -1) as 1 | -1; // bounce at the ends
          continue;
        }
        const seg = haversine(DEMO_ROUTE[s.idx], DEMO_ROUTE[next]);
        if (seg <= 0) {
          s.idx = next;
          continue;
        }
        if (remaining >= seg) {
          s.idx = next;
          remaining -= seg;
        } else {
          s.pos = {
            ...interpolate(DEMO_ROUTE[s.idx], DEMO_ROUTE[next], remaining / seg),
            at: new Date().toISOString(),
          };
          remaining = 0;
        }
      }
      const h = bearingDeg(before, s.pos);
      simHeadingRef.current = h;
      pushPoint(s.pos, speed, h);
    }, SIM_TICK_MS);

    return () => clearInterval(t);
  }, [demoMode, demoSpeed, pushPoint]);

  /* ── Demo sequence runner: 0 → 4.5 → 32 km/h, auto-advancing ── */
  const runDemoSequence = useCallback(() => {
    setDemoModeState(true);
    setSequenceRunning(true);
    let i = 0;
    setDemoSpeedState(DEMO_SPEED_SEQUENCE[0]);
    if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    seqTimerRef.current = setInterval(() => {
      i += 1;
      if (i >= DEMO_SPEED_SEQUENCE.length) {
        if (seqTimerRef.current) clearInterval(seqTimerRef.current);
        seqTimerRef.current = null;
        setSequenceRunning(false);
        return;
      }
      setDemoSpeedState(DEMO_SPEED_SEQUENCE[i]);
    }, DEMO_STEP_MS);
  }, []);

  useEffect(
    () => () => {
      if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    },
    []
  );

  const setDemoMode = useCallback((on: boolean) => {
    setDemoModeState(on);
    if (seqTimerRef.current) {
      clearInterval(seqTimerRef.current);
      seqTimerRef.current = null;
    }
    setSequenceRunning(false);
    if (on) setDemoSpeedState((prev) => prev ?? 0);
  }, []);

  return {
    gps,
    heading,
    speedKmh,
    gpsError,
    demoMode,
    setDemoMode,
    demoSpeed,
    setDemoSpeed: setDemoSpeedState,
    sequenceRunning,
    runDemoSequence,
    effectiveSpeedKmh: demoMode ? (demoSpeed ?? 0) : speedKmh,
  };
}
