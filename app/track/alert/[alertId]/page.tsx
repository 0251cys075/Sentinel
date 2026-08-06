"use client";

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { BrandMark } from "@/components/shell";
import { Card } from "@/components/primitives";
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
 * Emergency tracking view opened when a trusted contact taps an SOS push
 * notification. Resolves alertId → trip via get_public_trip_by_alert()
 * (a SECURITY DEFINER SQL function — the alert UUID acts as a capability
 * token). Works without a Sentinel account; no login required. Live
 * position + speed arrive over Supabase Realtime.
 *
 * URL: /track/alert/[alertId]
 * FCM data payload sets: url = /track/alert/<alertId>
 */
function AlertTrackScreen() {
  const { alertId } = useParams<{ alertId: string }>();

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();

    // Resolve alertId → trip using the SECURITY DEFINER helper.
    const tripRes = await supabase.rpc("get_public_trip_by_alert", {
      p_alert_id: alertId,
    });

    if (tripRes.error || !tripRes.data) return { ok: false as const };

    // get_public_trip_by_alert returns setof trips (array) — take first row.
    const tripData = Array.isArray(tripRes.data) ? tripRes.data[0] : tripRes.data;
    if (!tripData) return { ok: false as const };

    // Load the location trail for this trip.
    const trailRes = await supabase.rpc("get_public_trip_locations", {
      p_trip_id: tripData.id,
    });
    return {
      ok: true as const,
      trip: tripData as Trip,
      trail: (trailRes.data ?? []) as TripLocation[],
    };
  }, [alertId]);

  const { trip, trail, latest, badge, notFound } = useGuestTracking(load);
  const street = useStreetName(latest?.lat ?? null, latest?.lng ?? null);

  if (notFound) {
    return (
      <div className="screen text-center">
        <p className="mt-24 text-muted">
          This SOS alert is no longer active or the link has expired.
        </p>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="screen pt-24 text-center">
        <span className="dot pulse" />
        <p className="mt-2 text-sm text-muted">Locating traveller…</p>
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
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <BrandMark />
          <span
            className="rounded-[20px] px-3 py-1 text-[11px] font-bold"
            style={{ background: "#FDECEA", color: "#E53E3E" }}
          >
            🚨 SOS ALERT
          </span>
        </div>

        {/* ── Alert summary card ──────────────────────────────────── */}
        <div
          className="mb-4 rounded-card border border-line bg-card p-[18px] shadow-card"
          style={{ borderColor: "#E53E3E22" }}
        >
          <div className="eyebrow" style={{ color: "#E53E3E" }}>
            Emergency alert
          </div>
          <h1 className="font-display mt-1 text-[22px]">{trip.destination_text}</h1>
          <p className="mt-1 text-sm text-muted">
            {trip.transit_mode} · ETA {trip.eta_minutes} min · expected{" "}
            {new Date(trip.expected_arrival_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
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

        {/* ── Info card ───────────────────────────────────────────── */}
        <Card className="mt-3">
          <b>What does this mean?</b>
          <p className="mt-1 text-xs leading-[1.5] text-muted">
            This person pressed the SOS button in the Sentinel app. Their live location
            and speed are shown above. Please try to contact them directly or alert
            emergency services if needed.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function AlertTrackPage() {
  return (
    <Suspense fallback={<div className="pt-24 text-center text-sm text-muted">Loading…</div>}>
      <AlertTrackScreen />
    </Suspense>
  );
}