"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reverse-geocode a live GPS fix into a street / locality label via
 * Nominatim (OpenStreetMap). Coarse key caching keeps request volume low
 * while moving; failures degrade to null (callers show coords instead).
 */

const KEY_ROUND = 4; // ~11 m grid — re-fetch only when the fix leaves it
const DEBOUNCE_MS = 400;

function pickLabel(data: {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
} | null): string | null {
  const a = data?.address ?? {};
  const road = a.road || a.pedestrian || a.path || a.footway || a.cycleway;
  const area = a.neighbourhood || a.suburb || a.locality || a.village || a.town || a.city;
  if (road && area) return `${road}, ${area}`;
  if (road) return road;
  if (area) return area;
  if (data?.name) return data.name;
  if (typeof data?.display_name === "string") return data.display_name.split(",")[0];
  return null;
}

type NominatimResult = {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
} | null;

export function useStreetName(lat: number | null, lng: number | null): string | null {
  const [label, setLabel] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (lat == null || lng == null) return;

    const key = `${lat.toFixed(KEY_ROUND)},${lng.toFixed(KEY_ROUND)}`;
    const cached = cacheRef.current.get(key);
    if (cached !== undefined) {
      setLabel(cached);
      return;
    }

    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=en`,
        { signal: ctrl.signal }
      )
        .then((r) => (r.ok ? (r.json() as Promise<NominatimResult>) : Promise.resolve(null)))
        .then((data) => {
          if (cancelled) return;
          const name = pickLabel(data);
          if (name) {
            cacheRef.current.set(key, name);
            setLabel(name);
          } else {
            setLabel(null);
          }
        })
        .catch(() => {
          if (!cancelled) setLabel(null);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [lat, lng]);

  return label;
}
