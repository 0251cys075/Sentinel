"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { BrandMark } from "@/components/shell";
import { Card } from "@/components/primitives";
import type { Trip, TripLocation } from "@/lib/types";

const STALE_AFTER_MS = 120_000;
const LIVE_AFTER_MS = 45_000;
const POLL_MS = 10_000;

/**
 * Public, no-login SOS live tracking for emergency contacts.
 *
 * URL: /sos/track/[sosId]?token=<guestToken>
 *
 * Uses a direct Supabase table query (no RPC, no auth session required).
 * The guest_token column on the alerts table acts as the capability token.
 * Expiration is bypassed for now — only `status === 'resolved'` invalidates
 * the link. If the query fails or returns no rows, a debug paragraph is
 * rendered so we can diagnose Incognito-mode issues.
 */
function SosTrackScreen() {
  const { sosId } = useParams<{ sosId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<TripLocation[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Defensive: never fire a query for a missing token.
    if (!sosId || !token) {
      setNotFound(true);
      return;
    }

    const supabase = getSupabaseBrowser();

    const load = async () => {
      // ── Fetch the alert directly by id + guest_token ──────
      // No auth session required — the anon/public client handles this.
      const { data: alert, error } = await supabase
        .from("alerts")
        .select("*")
        .eq("id", sosId)
        .eq("guest_token", token)
        .maybeSingle();

      // ── Debug display if the query failed or returned nothing ──
      if (error || !alert) {
        const parts: string[] = [];
        parts.push(`sosId=${sosId}`);
        parts.push(`token=${token}`);
        if (error) parts.push(`DB Error=${error.message}`);
        else parts.push("DB Error=no rows returned");
        setDebugInfo(parts.join(" | "));
        setNotFound(true);
        return;
      }

      // ── Bypass expiration check for now ────────────────────
      // Only invalidate if the alert is resolved.
      if (alert.status === "resolved") {
        setDebugInfo(
          `sosId=${sosId} | token=${token} | reason=alert status is 'resolved'`
        );
        setNotFound(true);
        return;
      }

      // ── Resolve alert → trip ──────────────────────────────
      const { data: tripData, error: tripError } = await supabase
        .from("trips")
        .select("*")
        .eq("id", alert.trip_id)
        .maybeSingle();

      if (tripError || !tripData) {
        setDebugInfo(
          `sosId=${sosId} | token=${token} | tripError=${tripError?.message ?? "no trip found"}`
        );
        setNotFound(true);
        return;
      }

      setTrip(tripData as Trip);

      // ── Live location trail ───────────────────────────────
      const trailRes = await supabase
        .from("trip_locations")
        .select("*")
        .eq("trip_id", tripData.id)
        .order("recorded_at", { ascending: true })
        .limit(500);

      setTrail((trailRes.data ?? []) as TripLocation[]);
    };

    load();
    const pollTimer = setInterval(load, POLL_MS);
    const tickTimer = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [sosId, token]);

  if (notFound) {
    return (
      <div className="screen text-center">
        <p className="mt-24 text-muted">
          This SOS alert is no longer active or the link has expired.
        </p>
        {debugInfo && (
          <p className="mt-4 text-xs text-muted" style={{ maxWidth: 480, margin: "1rem auto 0" }}>
            Debug Info: {debugInfo}
          </p>
        )}
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
            This person pressed the SOS button in the Sentinel app. Their last known location
            is shown above. Please try to contact them directly or alert emergency services if
            needed.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function SosTrackPage() {
  return (
    <Suspense fallback={<div className="pt-24 text-center text-sm text-muted">Loading…</div>}>
      <SosTrackScreen />
    </Suspense>
  );
}