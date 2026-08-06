"use client";

/**
 * Shared data layer for the three no-login guest tracking pages
 * (/track/[tripId], /track/alert/[alertId], /sos/track/[sosId]).
 *
 * Loads trip + trail (polling as a fallback) and subscribes to Supabase
 * Realtime so live position + speed telemetry arrive instantly — the
 * traveler broadcasts to trip_locations and guests render it with no
 * login and no page reload.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Trip, TripLocation } from "@/lib/types";

const STALE_AFTER_MS = 120_000;
const LIVE_AFTER_MS = 45_000;
const POLL_MS = 10_000;

export type GuestLoadResult =
  | { ok: true; trip: Trip; trail: TripLocation[] }
  | { ok: false; debug?: string };

export function useGuestTracking(load: () => Promise<GuestLoadResult>) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<TripLocation[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [debug, setDebug] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* ── Initial load + polling fallback ── */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await load();
      if (cancelled) return;
      if (!res.ok) {
        setTrip(null);
        setTrail([]);
        setDebug(res.debug ?? null);
        setNotFound(true);
        return;
      }
      setTrip(res.trip);
      setTrail((prev) => {
        const merged = [...prev];
        for (const row of res.trail) if (!merged.some((t) => t.id === row.id)) merged.push(row);
        return merged.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      });
      setNotFound(false);
    };
    run();
    const poll = setInterval(run, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  /* ── Supabase Realtime: live trip_locations INSERTs ── */
  const tripId = trip?.id;
  useEffect(() => {
    if (!tripId) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`guest-trip-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_locations",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const row = payload.new as TripLocation;
          setTrail((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  const latest = trail[trail.length - 1] ?? null;
  const ageMs = latest ? now - new Date(latest.recorded_at).getTime() : Infinity;
  const badge =
    ageMs < LIVE_AFTER_MS
      ? { cls: "live", txt: "● Live now" }
      : ageMs < STALE_AFTER_MS
        ? { cls: "upd", txt: `● Updated ${Math.floor(ageMs / 60_000)} min ago` }
        : { cls: "stale", txt: `● Last seen ${Math.floor(ageMs / 60_000)} min ago` };

  return { trip, trail, latest, ageMs, badge, notFound, debug };
}