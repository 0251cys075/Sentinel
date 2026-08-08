"use client";

/**
 * Feature 3 — Offline breadcrumb tracker.
 *
 * While a journey is active the native GPS watcher records a raw
 * `{ lat, lng, recorded_at }` breadcrumb on a ~15 s cadence straight into
 * localStorage (`sentinel_route_logs`) — no network required. When
 * connectivity comes back (`online` event, a new GPS fix, or a light retry
 * poll) the queue is bulk-inserted into `trip_locations` (same table the
 * Realtime guest tracking reads) and cleared.
 *
 * Storage choice: plain localStorage — points are ~60 bytes and the queue
 * is hard-capped at 5 000 entries (~300 KB), far under the 5 MB quota, so
 * IndexedDB's overhead is not justified by this footprint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export interface OfflineRoutePoint {
  lat: number;
  lng: number;
  recorded_at: string;
}

/** localStorage key that survives page reloads and dead zones. */
const STORAGE_KEY = "sentinel_route_logs";
/** Pre-spec key — migrated once on first mount so no breadcrumbs are lost. */
const LEGACY_STORAGE_KEY = "offline_route";
/** Cadence: capture at most one breadcrumb per 15 s. */
const RECORD_INTERVAL_MS = 15_000;
/** Hard cap — oldest points drop first so storage can never grow unbounded. */
const MAX_QUEUED_POINTS = 5_000;
/** Light retry poll: the `online` event can be missed on some engines. */
const FLUSH_RETRY_MS = 60_000;

export function useOfflineRoute({
  tripId,
  enabled = true,
  travelMode = "Walk",
}: {
  tripId: string | null;
  /** Disable while demo/stunt telemetry owns the stream. */
  enabled?: boolean;
  travelMode?: string;
}) {
  const [queuedCount, setQueuedCount] = useState(0);

  const queueRef = useRef<OfflineRoutePoint[]>([]);
  const lastRecordAtRef = useRef(0);
  const inflightRef = useRef(false);

  const tripIdRef = useRef(tripId);
  const travelModeRef = useRef(travelMode);
  useEffect(() => {
    tripIdRef.current = tripId;
  }, [tripId]);
  useEffect(() => {
    travelModeRef.current = travelMode;
  }, [travelMode]);

  /** Replace the in-memory queue, persist it, publish the count. */
  const writeQueue = useCallback((next: OfflineRoutePoint[]) => {
    queueRef.current = next;
    setQueuedCount(next.length);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — the in-memory queue still syncs this tab */
    }
  }, []);

  /** Rehydrate whatever survived the last dead zone at mount. */
  useEffect(() => {
    try {
      let raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // One-time migration from the pre-spec key.
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          raw = legacy;
          window.localStorage.setItem(STORAGE_KEY, legacy);
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
      if (!raw) return;
      const parsed = JSON.parse(raw) as OfflineRoutePoint[];
      if (Array.isArray(parsed)) {
        queueRef.current = parsed.slice(-MAX_QUEUED_POINTS);
        setQueuedCount(queueRef.current.length);
      }
    } catch {
      /* corrupt queue — start fresh */
    }
  }, []);

  /**
   * Bulk-upload every queued point to trip_locations and drop exactly the
   * uploaded batch (points appended while the request was in flight stay
   * queued). Rate-limited to one flight at a time.
   */
  const flushQueue = useCallback(async (): Promise<number> => {
    if (inflightRef.current) return 0;
    const pending = queueRef.current;
    if (!pending.length) return 0;
    if (typeof navigator === "undefined" || !navigator.onLine) return 0;
    if (!tripIdRef.current) return 0;

    inflightRef.current = true;
    try {
      const rows = pending.map((p) => ({
        trip_id: tripIdRef.current as string,
        lat: p.lat,
        lng: p.lng,
        recorded_at: p.recorded_at,
        speed_kmh: null,
        heading: null,
        travel_mode: travelModeRef.current,
      }));
      const { error } = await getSupabaseBrowser()
        .from("trip_locations")
        .insert(rows);
      if (error) {
        console.error("[offline-route] bulk upload failed:", error.message);
        return 0;
      }
      // Uploaded batch is a prefix — everything appended since stays put.
      writeQueue(queueRef.current.slice(pending.length));
      return rows.length;
    } finally {
      inflightRef.current = false;
    }
  }, [writeQueue]);

  /** GPS recorder: watchPosition at ~15 s cadence, straight to storage. */
  useEffect(() => {
    if (!enabled || !tripId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const onPosition = (pos: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastRecordAtRef.current < RECORD_INTERVAL_MS) return;
      lastRecordAtRef.current = now;

      const point: OfflineRoutePoint = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        recorded_at: new Date().toISOString(),
      };
      writeQueue([...queueRef.current, point].slice(-MAX_QUEUED_POINTS));

      // Connectivity is back and points are still pending — sync on the spot
      // so a missed `online` event can never strand the queue.
      void flushQueue();
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, () => {
      /* GPS dead — the queue keeps whatever we have until it recovers */
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, tripId, writeQueue, flushQueue]);

  /* ── Connectivity recovery hooks ── */
  useEffect(() => {
    const onOnline = () => {
      void flushQueue();
    };
    window.addEventListener("online", onOnline);

    // Missed-event insurance + page-exit best-effort sweep.
    const retry = setInterval(() => {
      void flushQueue();
    }, FLUSH_RETRY_MS);
    const onPageHide = () => {
      if (navigator.onLine) void flushQueue();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(retry);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushQueue]);

  return { queuedCount, points: queueRef.current, flushQueue };
}