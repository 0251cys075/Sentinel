"use client";

/**
 * Google-Maps-style live navigation map: OpenStreetMap tiles via Leaflet,
 * a smoothly-animated user marker that the viewport follows, and a route
 * polyline connecting origin → live trail → destination.
 *
 * Import this through `next/dynamic(..., { ssr: false })` — Leaflet touches
 * `window` at import time.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversine, type LatLng } from "@/lib/telemetry";

const USER_DOT = '<div class="live-user-dot"></div>';
const END_PIN = '<div class="map-pin-end"></div>';

const FOLLOW_RADIUS_M = 40;

export function LiveNavMap({
  trail,
  user,
  destination,
}: {
  trail: LatLng[];
  user: LatLng | null;
  destination: LatLng | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const originMarkerRef = useRef<L.CircleMarker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const didFitRef = useRef(false);

  /* ── Initialise map once ── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, { zoomControl: false, attributionControl: false });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const start = user ?? (trail.length ? trail[trail.length - 1] : destination) ?? {
      lat: 13.0827,
      lng: 80.2707,
    };
    map.setView([start.lat, start.lng], 15);

    const userIcon = L.divIcon({
      className: "live-user-marker-icon",
      html: USER_DOT,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    userMarkerRef.current = L.marker([start.lat, start.lng], {
      icon: userIcon,
      zIndexOffset: 1000,
    }).addTo(map);

    // Custom zoom controls (mirrors the SafeRouteMap pattern).
    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "+";
    zoomIn.className =
      "map-zoom-btn absolute right-3 top-[52px] z-[1000] h-9 w-9 rounded-[10px] border border-line bg-card text-[20px] font-bold text-primary shadow-card";
    zoomIn.addEventListener("click", () => map.zoomIn());
    const zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.textContent = "−";
    zoomOut.className =
      "map-zoom-btn absolute right-3 top-[96px] z-[1000] h-9 w-9 rounded-[10px] border border-line bg-card text-[20px] font-bold text-primary shadow-card";
    zoomOut.addEventListener("click", () => map.zoomOut());
    host.parentElement?.appendChild(zoomIn);
    host.parentElement?.appendChild(zoomOut);

    const t = setTimeout(() => map.invalidateSize(), 60);

    return () => {
      clearTimeout(t);
      zoomIn.remove();
      zoomOut.remove();
      map.remove();
      mapRef.current = null;
      userMarkerRef.current = null;
      originMarkerRef.current = null;
      destMarkerRef.current = null;
      trailLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Follow the user's live position ── */
  useEffect(() => {
    if (!user) return;
    userMarkerRef.current?.setLatLng([user.lat, user.lng]);
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    if (haversine({ lat: c.lat, lng: c.lng }, user) > FOLLOW_RADIUS_M) {
      map.panTo([user.lat, user.lng], { animate: true, duration: 0.8 });
    }
  }, [user]);

  /* ── Trail polyline + origin dot ── */
  useEffect(() => {
    if (!trail.length) return;
    if (trailLineRef.current) {
      trailLineRef.current.remove();
      trailLineRef.current = null;
    }
    if (trail.length > 1) {
      trailLineRef.current = L.polyline(
        trail.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#0f6e56", weight: 5, opacity: 0.85, lineCap: "round", lineJoin: "round" }
      ).addTo(mapRef.current!);
    }
    if (!originMarkerRef.current && mapRef.current) {
      const o = trail[0];
      originMarkerRef.current = L.circleMarker([o.lat, o.lng], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 1,
      }).addTo(mapRef.current);
    }
  }, [trail]);

  /* ── Destination marker + one-shot fit to route bounds ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    if (destination) {
      const endIcon = L.divIcon({
        className: "",
        html: END_PIN,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: endIcon })
        .addTo(map)
        .bindPopup("Destination");
    }
    if (destination && !didFitRef.current) {
      const bounds: [number, number][] = [user, trail[0], trail[trail.length - 1]]
        .filter((p): p is LatLng => !!p)
        .map((p) => [p.lat, p.lng] as [number, number]);
      bounds.push([destination.lat, destination.lng]);
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
      didFitRef.current = true;
    }
  }, [destination, user, trail]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}