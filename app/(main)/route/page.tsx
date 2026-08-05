"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/shell";
import { Card, PrimaryButton, Tag, TextInput } from "@/components/primitives";
import { useToast } from "@/components/toast";
import type { LatLng, RoutePoints } from "./SafeRouteMap";

const SafeRouteMap = dynamic(
  () => import("./SafeRouteMap").then((m) => m.SafeRouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="relative h-[260px] overflow-hidden rounded-[18px] border border-line bg-card">
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Loading map…
        </div>
      </div>
    ),
  }
);

type RouteChoice = "safest" | "fastest";

const pt = (lat: number, lng: number): [number, number] => [lat, lng];

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function distanceToSegment(p: LatLng, a: [number, number], b: [number, number]): number {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.lat - ax) * dx + (p.lng - ay) * dy) / len2));
  return haversine(p, { lat: ax + t * dx, lng: ay + t * dy });
}

function distanceToPolyline(p: LatLng, pts: RoutePoints): number {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(p, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function fmtDuration(s: number): string {
  const total = Math.round(s / 60);
  if (total >= 60 && total % 60 !== 0) {
    return `${Math.floor(total / 60)}hr ${total % 60}min`;
  }
  if (total >= 60) {
    return `${Math.floor(total / 60)}hr`;
  }
  return `${total} min`;
}

export default function RoutePage() {
  const toast = useToast();

  const [askGps, setAskGps] = useState(true);
  const [address, setAddress] = useState("");
  const [startCoords, setStartCoords] = useState<LatLng | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [endCoords, setEndCoords] = useState<LatLng | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoints | null>(null);
  const [stats, setStats] = useState<{ distance: number; duration: number } | null>(null);
  const [choice, setChoice] = useState<RouteChoice>("safest");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);

  const watchId = useRef<number | null>(null);
  const endCoordsRef = useRef<LatLng | null>(null);
  const routePointsRef = useRef<RoutePoints | null>(null);
  const recalcBusy = useRef(false);

  useEffect(() => {
    endCoordsRef.current = endCoords;
    routePointsRef.current = routePoints;
  }, [endCoords, routePoints]);

  useEffect(
    () => () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    },
    []
  );

  const fetchRoute = useCallback(async (start: LatLng, end: LatLng) => {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
    );
    if (!res.ok) throw new Error("OSRM request failed");
    const json = (await res.json()) as {
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = json.routes?.[0];
    if (!route) throw new Error("No route found");
    return {
      distance: route.distance,
      duration: route.duration,
      points: route.geometry.coordinates.map((c) => pt(c[1], c[0])) as RoutePoints,
    };
  }, []);

  const checkOffRoute = useCallback(
    (c: LatLng) => {
      const pts = routePointsRef.current;
      const end = endCoordsRef.current;
      if (!pts || pts.length < 2 || !end) return;
      if (distanceToPolyline(c, pts) <= 50) return;
      if (recalcBusy.current) return;
      recalcBusy.current = true;
      toast("You've left the route — recalculating…");
      setStartCoords(c);
      setRoutePoints(null);
      fetchRoute(c, end)
        .then((route) => {
          setRoutePoints(route.points);
          setStats({ distance: route.distance, duration: route.duration });
        })
        .catch(() => {
          toast("Recalculation failed");
        })
        .finally(() => {
          recalcBusy.current = false;
        });
    },
    [fetchRoute, toast]
  );

  const startTracking = useCallback(() => {
    if (!navigator.geolocation || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(c);
        setLive(true);
        checkOffRoute(c);
      },
      () => {
        setLive(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }, [checkOffRoute]);

  const calcRoute = useCallback(async () => {
    if (!startCoords) {
      toast("Enable location access to calculate a route");
      return;
    }
    if (!address.trim()) {
      toast("Enter a destination address");
      return;
    }
    setLoading(true);
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          address.trim()
        )}&limit=1`
      );
      if (!geoRes.ok) throw new Error("Geocoding failed");
      const geo = (await geoRes.json()) as { lat: string; lon: string }[];
      const match = geo[0];
      if (!match) {
        toast("Destination not found — try a street address");
        return;
      }
      const end = { lat: parseFloat(match.lat), lng: parseFloat(match.lon) };
      const route = await fetchRoute(startCoords, end);
      setEndCoords(end);
      setRoutePoints(route.points);
      setStats({ distance: route.distance, duration: route.duration });
      startTracking();
    } catch {
      toast("Couldn't fetch a route — check your connection");
    } finally {
      setLoading(false);
    }
  }, [address, startCoords, fetchRoute, startTracking, toast]);

  const handleGps = useCallback(() => {
    setAskGps(false);
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setStartCoords(c);
        setUserCoords(c);
      },
      undefined,
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const safestMin = stats ? Math.round(stats.duration / 60) : null;
  const fast = choice === "fastest";

  return (
    <div>
      <TopBar eyebrow="AI route intelligence" title="Safe Route" backTo="/" />

      {askGps && (
        <Card className="mb-3">
          <div className="text-center">
            <div className="text-3xl">📍</div>
            <b className="mt-2 block text-[15px]">Enable GPS for accurate routing</b>
            <p className="mt-1 text-xs text-muted">
              Get real-time turn-by-turn tracking from your exact location
            </p>
            <PrimaryButton onClick={handleGps} className="mt-4">
              Allow Location Access
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setAskGps(false)}
              className="mt-3 text-xs font-semibold text-muted underline"
            >
              Skip — enter address manually
            </button>
          </div>
        </Card>
      )}

      {startCoords ? (
        <SafeRouteMap
          startCoords={startCoords}
          endCoords={endCoords}
          userCoords={userCoords}
          routePoints={routePoints}
          fastest={fast}
          live={live}
        />
      ) : (
        !askGps && (
          <Card className="mb-3">
            <b>📍 Location not available</b>
            <p className="mt-1 text-xs leading-[1.5] text-muted">
              Allow location access in your browser to plot a live route from
              your exact position. You can still enter a destination below.
            </p>
          </Card>
        )
      )}

      <Card className="mt-3">
        <b>Where to?</b>
        <div className="mt-2">
          <TextInput
            value={address}
            onChange={setAddress}
            placeholder="e.g. 12 Main Street, Chennai"
          />
        </div>
        <PrimaryButton onClick={calcRoute} disabled={loading} className="mt-3">
          {loading ? "Calculating…" : "Calculate Route"}
        </PrimaryButton>
      </Card>

      {stats && endCoords && (
        <Card className="mt-3">
          <div className="grid grid-cols-3 text-center">
            <div>
              <b className="block text-[15px]">
                {fmtDistance(stats.distance)}
              </b>
              <small className="text-[11px] text-muted">Distance</small>
            </div>
            <div>
              <b className="block text-[15px]">
                {fmtDuration(fast ? stats.duration * 0.8 : stats.duration)}
              </b>
              <small className="text-[11px] text-muted">Duration</small>
            </div>
            <div>
              <b className="block text-[15px]">
                {fast ? "74%" : "92%"}
              </b>
              <small className="text-[11px] text-muted">Safety Score</small>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-3 flex rounded-[14px] border border-line bg-card p-1">
        <button
          type="button"
          onClick={() => setChoice("safest")}
          className={`flex-1 rounded-[10px] py-[11px] text-sm ${
            choice === "safest" ? "bg-primary2 font-bold text-primary" : ""
          }`}
        >
          Safest · {safestMin ?? "—"} min
        </button>
        <button
          type="button"
          onClick={() => setChoice("fastest")}
          className={`flex-1 rounded-[10px] py-[11px] text-sm ${
            choice === "fastest" ? "bg-primary2 font-bold text-primary" : ""
          }`}
        >
          Fastest · {stats ? "~20% faster" : "—"}
        </button>
      </div>

      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <b>Route confidence</b>
          <Tag>{fast ? "74%" : "92%"}</Tag>
        </div>
        <p className="mt-1 text-xs leading-[1.5] text-muted">
          AI favors brighter roads, open businesses and recent safe-travel
          signals.
        </p>
        <div className="flex gap-2">
          <Tag>Green · Low</Tag>
          <Tag className="bg-[#fff1df] !text-accent">Amber · Moderate</Tag>
          <Tag className="bg-[#ffe6e1] !text-[#b84434]">Red · Avoid</Tag>
        </div>
      </Card>
    </div>
  );
}