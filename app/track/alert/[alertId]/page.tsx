"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { BrandMark } from "@/components/shell";
import { Card } from "@/components/primitives";
import type { Trip, TripLocation } from "@/lib/types";

const STALE_AFTER_MS = 120_000;
const LIVE_AFTER_MS = 45_000;
const POLL_MS = 10_000;

/**
 * Emergency tracking view opened when a trusted contact taps an SOS push
 * notification. Resolves alertId → trip via get_public_trip_by_alert()
 * (a SECURITY DEFINER SQL function — the alert UUID acts as a capability
 * token). Works without a Sentinel account; no login required.
 *
 * URL: /track/alert/[alertId]
 * FCM data payload sets: url = /track/alert/<alertId>
 */
function AlertTrackScreen() {
  const { alertId } = useParams<{ alertId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<TripLocation[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const load = async () => {
      // Resolve alertId → trip using the SECURITY DEFINER helper.
      const tripRes = await supabase.rpc("get_public_trip_by_alert", {
        p_alert_id: alertId,
      });

      if (tripRes.error || !tripRes.data) {
        setNotFound(true);
        return;
      }

      // get_public_trip_by_alert returns setof trips (array) — take first row.
      const tripData = Array.isArray(tripRes.data) ? tripRes.data[0] : tripRes.data;
      if (!tripData) {
        setNotFound(true);
        return;
      }
      setTrip(tripData as Trip);

      // Load the location trail for this trip.
      const trailRes = await supabase.rpc("get_public_trip_locations", {
        p_trip_id: tripData.id,
      });
      setTrail((trailRes.data ?? []) as TripLocation[]);
    };

    load();
    const pollTimer = setInterval(load, POLL_MS);
    const tickTimer = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [alertId]);

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

  const latest = trail[trail.length - 1];
  const ageMs = latest ? now - new Date(latest.recorded_at).getTime() : Infinity;
  const badge =
    ageMs < LIVE_AFTER_MS
      ? { cls: "live", txt: "● Live now" }
      : ageMs < STALE_AFTER_MS
        ? { cls: "upd", txt: `● Updated ${Math.floor(ageMs / 60_000)} min ago` }
        : { cls: "stale", txt: `● Last seen ${Math.floor(ageMs / 60_000)} min ago` };

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

        {/* ── Map / location area ─────────────────────────────────── */}
        <div className="map">
          <div className={`mapbadge ${badge.cls}`}>{badge.txt}</div>
          <div className="livebar">
            <div>
              <b>{latest ? "Position shared" : "Awaiting first fix"}</b>
              <br />
              <small className="text-muted">
                {latest
                  ? `${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
                  : "No location yet"}
              </small>
            </div>
          </div>
        </div>

        {/* ── Info card ───────────────────────────────────────────── */}
        <Card className="mt-3">
          <b>What does this mean?</b>
          <p className="mt-1 text-xs leading-[1.5] text-muted">
            This person pressed the SOS button in the Sentinel app. Their last known location is
            shown above. Please try to contact them directly or alert emergency services if
            needed.
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
