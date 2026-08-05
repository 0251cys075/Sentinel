"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

export type LatLng = { lat: number; lng: number };
export type RoutePoints = [number, number][];

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const START_ICON = '<div class="map-pin-start"></div>';
const END_ICON = '<div class="map-pin-end"></div>';

const pt = (lat: number, lng: number): [number, number] => [lat, lng];

export function SafeRouteMap({
  startCoords,
  endCoords,
  userCoords,
  routePoints,
  fastest = false,
  live = false,
}: {
  startCoords: LatLng;
  endCoords: LatLng | null;
  userCoords: LatLng | null;
  routePoints: RoutePoints | null;
  fastest?: boolean;
  live?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const endMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const heatCirclesRef = useRef<L.Circle[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, { zoomControl: false, attributionControl: false });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const startIcon = L.divIcon({
      className: "",
      html: START_ICON,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    startMarkerRef.current = L.marker([startCoords.lat, startCoords.lng], {
      icon: startIcon,
    })
      .addTo(map)
      .bindPopup("Start");

    userMarkerRef.current = L.circleMarker([startCoords.lat, startCoords.lng], {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillColor: "#22c55e",
      fillOpacity: 1,
    }).addTo(map);

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

    map.setView(pt(startCoords.lat, startCoords.lng), 13);

    return () => {
      zoomIn.remove();
      zoomOut.remove();
      map.remove();
      mapRef.current = null;
      startMarkerRef.current = null;
      endMarkerRef.current = null;
      userMarkerRef.current = null;
      routeLineRef.current = null;
      heatCirclesRef.current = [];
    };
  }, [startCoords]);

  useEffect(() => {
    startMarkerRef.current?.setLatLng(pt(startCoords.lat, startCoords.lng));
  }, [startCoords]);

  useEffect(() => {
    if (userMarkerRef.current && userCoords) {
      userMarkerRef.current.setLatLng(pt(userCoords.lat, userCoords.lng));
    }
  }, [userCoords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (endMarkerRef.current) {
      endMarkerRef.current.remove();
      endMarkerRef.current = null;
    }
    if (endCoords) {
      const endIcon = L.divIcon({
        className: "",
        html: END_ICON,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      endMarkerRef.current = L.marker([endCoords.lat, endCoords.lng], {
        icon: endIcon,
      })
        .addTo(map)
        .bindPopup("Destination");
    }

    heatCirclesRef.current.forEach((c) => c.remove());
    heatCirclesRef.current = [];
    const heatZones: { point: [number, number]; color: string }[] =
      routePoints && routePoints.length > 1
        ? [
            { point: routePoints[0], color: "#22c55e" },
            {
              point: routePoints[Math.floor(routePoints.length / 2)],
              color: "#f59e0b",
            },
            {
              point: routePoints[routePoints.length - 1],
              color: "#ef4444",
            },
          ]
        : endCoords
          ? [
              { point: pt(startCoords.lat, startCoords.lng), color: "#22c55e" },
              {
                point: pt(
                  (startCoords.lat + endCoords.lat) / 2,
                  (startCoords.lng + endCoords.lng) / 2
                ),
                color: "#f59e0b",
              },
              { point: pt(endCoords.lat, endCoords.lng), color: "#ef4444" },
            ]
          : [{ point: pt(startCoords.lat, startCoords.lng), color: "#22c55e" }];
    heatZones.forEach(({ point, color }) => {
      heatCirclesRef.current.push(
        L.circle(point, {
          radius: 300,
          color,
          fillColor: color,
          fillOpacity: 0.12,
          opacity: 0.12,
        }).addTo(map)
      );
    });

    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    const line: RoutePoints | null =
      routePoints && routePoints.length > 1 && !fastest
        ? routePoints
        : endCoords
          ? [
              pt(startCoords.lat, startCoords.lng),
              pt(endCoords.lat, endCoords.lng),
            ]
          : null;
    if (line) {
      routeLineRef.current = L.polyline(line, {
        color: fastest ? "#c9622f" : "#0f6e56",
        weight: 4,
        opacity: 0.9,
        ...(fastest ? { dashArray: "10 8" } : {}),
      }).addTo(map);
    }

    if (endCoords) {
      map.fitBounds(
        [
          pt(startCoords.lat, startCoords.lng),
          pt(endCoords.lat, endCoords.lng),
        ],
        { padding: [48, 48] }
      );
    } else {
      map.setView(pt(startCoords.lat, startCoords.lng), 13);
    }
  }, [startCoords, endCoords, routePoints, fastest]);

  return (
    <div className="relative h-[260px] overflow-hidden rounded-[18px] border border-line bg-card">
      <div ref={hostRef} className="h-full w-full" />
      {live && userCoords && (
        <div className="absolute right-3 top-3 z-[1000] flex items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-[11px] font-bold text-primary shadow-card">
          <span className="dot pulse" />
          Live
        </div>
      )}
    </div>
  );
}