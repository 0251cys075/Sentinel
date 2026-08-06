/**
 * Shared telemetry math used by the live journey, SOS stream, demo
 * simulator and the guest tracking pages.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GpsPoint extends LatLng {
  at: string;
}

/** Great-circle distance in meters (Haversine). */
export function haversine(a: LatLng | null | undefined, b: LatLng | null | undefined): number {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** km/h from two GPS fixes and a time delta (ms). Null when inputs are invalid. */
export function speedFromPoints(a: GpsPoint | null, b: GpsPoint | null, deltaMs: number): number | null {
  if (!a || !b || deltaMs <= 0) return null;
  return (haversine(a, b) / deltaMs) * 3600;
}

/** Remaining straight-line distance in km from the current fix to the destination. */
export function remainingKm(
  current: LatLng | null,
  destLat: number | null,
  destLng: number | null
): number | null {
  if (!current || destLat == null || destLng == null) return null;
  return haversine(current, { lat: destLat, lng: destLng }) / 1000;
}

/** Dynamic ETA in minutes from current speed + remaining distance. */
export function dynamicEtaMin(speedKmh: number | null, remKm: number | null): number | null {
  if (speedKmh == null || remKm == null || remKm <= 0 || speedKmh <= 0.1) return null;
  return Math.round((remKm / speedKmh) * 60);
}

/** Bearing in degrees (0-360, from true north) between two points. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

/** Linear interpolation between two points, t in [0,1]. */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Speed categories for the ⚡ telemetry badge. */
export interface SpeedBadgeInfo {
  cls: string;
  txt: string;
  color: string;
  bg: string;
}

export function classifySpeed(kmh: number | null): SpeedBadgeInfo | null {
  if (kmh == null || !isFinite(kmh)) return null;
  if (kmh <= 0.5) return { cls: "stopped", txt: "Stationary", color: "#A0A0A0", bg: "#F0F0F0" };
  if (kmh <= 7)
    return { cls: "walking", txt: `⚡ ${kmh.toFixed(1)} km/h (Walking)`, color: "#388E3C", bg: "#E8F5E9" };
  if (kmh <= 15)
    return { cls: "active", txt: `⚡ ${kmh.toFixed(1)} km/h (Running / Cycling)`, color: "#F57C00", bg: "#FFF3E0" };
  return { cls: "vehicle", txt: `⚡ ${kmh.toFixed(1)} km/h (In Vehicle)`, color: "#1565C0", bg: "#E3F2FD" };
}

/**
 * Synthetic demo route (Chennai, Anna Nagar → Nungambakkam) used by the
 * Demo Telemetry simulator so the map marker keeps moving indoors during
 * judge presentations even when the browser GPS fix is unavailable.
 */
export const DEMO_ROUTE: LatLng[] = [
  { lat: 13.0827, lng: 80.2707 },
  { lat: 13.0799, lng: 80.2659 },
  { lat: 13.0760, lng: 80.2610 },
  { lat: 13.0721, lng: 80.2561 },
  { lat: 13.0681, lng: 80.2514 },
  { lat: 13.0644, lng: 80.2469 },
  { lat: 13.0610, lng: 80.2430 },
  { lat: 13.0581, lng: 80.2398 },
  { lat: 13.0558, lng: 80.2408 },
];
