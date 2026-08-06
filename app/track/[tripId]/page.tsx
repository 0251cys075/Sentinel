"use client";

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { BrandMark } from "@/components/shell";
import { Card, DemoBadge } from "@/components/primitives";
import { SpeedBadge } from "@/components/speed-badge";
import { useGuestTracking } from "@/lib/use-guest-tracking";
import { useStreetName } from "@/lib/use-street-name";
import type { Trip, TripLocation } from "@/lib/types";

const LiveNavMap = dynamic(() => import("@/components/live-nav-map").then((m) => m.LiveNavMap), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs text-muted">
      Loading map…
    </div>
  ),
});

/**
 * Read-only "track this trip" view shared with trusted contacts via the
 * push notification link. Works without an account: it reads through
 * SECURITY DEFINER functions (see supabase/share.sql) and subscribes to
 * Supabase Realtime so the live position + speed update in real time.
 * Unguessable UUID = the capability.
 */
function TrackScreen() {
  const { tripId } = useParams<{ tripId: string }>();

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const [tripRes, trailRes] = await Promise.all([
      supabase.rpc("get_public_trip", { p_trip_id: tripId }),
      supabase.rpc("get_public_trip_locations", { p_trip_id: tripId }),
    ]);
    if (tripRes.error || !tripRes.data) return { ok: false as const };
    return {
      ok: true as const,
      trip: tripRes.data as Trip,
      trail: (trailRes.data ?? []) as TripLocation[],
    };
  }, [tripId]);

  const { trip, trail, latest, badge, notFound } = useGuestTracking(load);
  const street = useStreetName(latest?.lat ?? null, latest?.lng ?? null);

  if (notFound) {
    return (
      <div className="screen text-center">
        <p className="mt-24 text-muted">This journey is no longer shared.</p>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="screen pt-24 text-center">
        <span className="dot pulse" />
        <p className="mt-2 text-sm text-muted">Loading shared journey…</p>
      </div>
    );
  }

  const destination =
    trip.destination_lat != null && trip.destination_lng != null
      ? { lat: trip.destination_lat, lng: trip.destination_lng }
      : null;

  return (
    <div className="app-shell">
      <div className="screen">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <DemoBadge text="Read-only share" />
        </div>

        <div className="mb-4 rounded-card border border-line bg-card p-[18px] shadow-card">
          <div className="eyebrow">Shared journey</div>
          <h1 className="font-display mt-1 text-[22px]">
            {trip.destination_text}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {trip.transit_mode} · ETA {trip.eta_minutes} min + {trip.buffer_minutes} min
            buffer ·{" "}
            {new Date(trip.expected_arrival_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {trip.status !== "active" && trip.status !== "escalated" && (
            <span className="mt-2 inline-block rounded-[20px] bg-primary2 px-2.5 py-1 text-[11px] font-bold text-primary">
              {trip.status.toUpperCase()}
            </span>
          )}
        </div>

        {/* ── Live map + speed overlay ── */}
        <div className="map">
          <LiveNavMap
            trail={trail.map((t) => ({ lat: t.lat, lng: t.lng }))}
            user={latest ?? null}
            destination={destination}
          />
          <div className={`mapbadge ${badge.cls}`}>{badge.txt}</div>
          <div className="livebar">
            <div className="min-w-0 pr-3">
              <b>{latest ? "Position shared" : "Awaiting first fix"}</b>
              <br />
              <small className="text-muted">
                {latest
                  ? street ?? `${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
                  : "No location yet"}
              </small>
            </div>
            {latest ? <SpeedBadge kmh={latest.speed_kmh} /> : null}
          </div>
        </div>

        <Card className="mt-3">
          <b>About this share</b>
          <p className="mt-1 text-xs leading-[1.5] text-muted">
            The traveler asked Sentinel to share this journey with you. It
            updates in real time while active and stops when the trip
            ends.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="pt-24 text-center text-sm text-muted">Loading…</div>}>
      <TrackScreen />
    </Suspense>
  );
}