/**
 * SOS guest-tracking + deep-link helpers.
 *
 * When a user triggers SOS we mint a short-lived capability token, stash it
 * on the alert row, and share a public `/sos/track/<alertId>?token=…` URL
 * that emergency contacts can open WITHOUT logging in (see
 * `get_public_sos_track()` in supabase/sos_guest_tracking.sql).
 *
 * The same token is used to construct a native `sms:` deep link so mobile
 * contacts get the live link delivered straight into their SMS composer —
 * one tap to send.
 */

/** How long a guest tracking token stays valid (4 hours). */
export const GUEST_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Cryptographically-random 32-char hex token. Browser-safe (Web Crypto,
 * available everywhere modern — also present as globalThis.crypto in Node
 * 18+/Next.js route handlers). Empty string on exotic environments that
 * lack crypto: callers must treat that as "cannot mint a token".
 */
export function generateGuestToken(): string {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.getRandomValues) return "";
  const bytes = new Uint8Array(16); // 16 bytes → 32 hex chars
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** ISO expiry for a fresh guest token. */
export function guestTokenExpiry(now = Date.now()): string {
  return new Date(now + GUEST_TOKEN_TTL_MS).toISOString();
}

/**
 * The public, no-login tracking URL sent to emergency contacts.
 * `baseUrl` is e.g. NEXT_PUBLIC_APP_URL (no trailing slash).
 */
export function buildGuestTrackUrl(
  baseUrl: string,
  alertId: string,
  token: string
): string {
  const base = baseUrl.replace(/\/+$/, ""); // drop any trailing slashes
  return `${base}/sos/track/${encodeURIComponent(alertId)}?token=${encodeURIComponent(token)}`;
}

/**
 * SMS deep link as requested:
 *   sms:[PrimaryContactPhone]?body=EMERGENCY! <name> has activated SOS.
 *   Track live location & updates here without logging in: <guest URL>
 *
 * Phone is normalized to digits/`+` (strips the spaces users love to type).
 */
export function buildSosSmsDeepLink(phone: string, message: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return `sms:${digits}?body=${encodeURIComponent(message)}`;
}

/**
 * Body text for the SOS SMS. Never hardcodes a display name — falls back to
 * a neutral label when the profile is missing/incomplete.
 */
export function buildSosMessage(fullName: string | null | undefined, guestUrl: string): string {
  const who = fullName?.trim() || "A Sentinel user";
  return (
    `EMERGENCY! ${who} has activated SOS. ` +
    "Track live location & updates here without logging in: " +
    guestUrl
  );
}

/**
 * Offline SMS fallback body — no guest URL exists without a network, so the
 * maps link carries the exact last-known coordinates:
 *   EMERGENCY! I need help. My last known location: https://maps.google.com/?q=lat,lng
 * Pass `null` when the position could not be resolved (the location clause is
 * then omitted rather than sending a dead link).
 */
export function buildOfflineSosMessage(locationUrl: string | null): string {
  const location = locationUrl ? ` My last known location: ${locationUrl}` : "";
  return `EMERGENCY! I need help.${location}`;
}

/** Google Maps coordinates link used in the offline SMS body. */
export function buildMapsLocationUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

/** Last-resort emergency number when no trusted contacts are available. */
export const EMERGENCY_FALLBACK_NUMBER = "112";

/**
 * The number the offline SOS falls back to. Honors the user's own
 * `emergency_contact` preference (e.g. a specific police / family number
 * stashed in localStorage), then defaults to 112 — the number always
 * reachable, with or without stored contacts.
 */
export function emergencySmsNumber(): string {
  if (typeof window === "undefined") return EMERGENCY_FALLBACK_NUMBER;
  try {
    const stored = window.localStorage.getItem("emergency_contact");
    if (stored) {
      const digits = stored.replace(/[^\d+]/g, "");
      if (digits) return digits;
    }
  } catch {
    /* storage blocked/disabled — fall through to the default */
  }
  return EMERGENCY_FALLBACK_NUMBER;
}

/**
 * Body for the no-contacts offline SOS SMS (same wording as the requested
 * handler). The maps link carries the coordinates; pass `null` when the
 * position could not be resolved so no dead link is included.
 */
export function buildEmergencySmsMessage(locationUrl: string | null): string {
  const location = locationUrl ? ` My location: ${locationUrl}` : "";
  return `EMERGENCY! I need immediate help.${location}`;
}

/** GPS pass for the SOS SMS (fast, cached-fix-first): the SMS must fire in
 *  seconds, not after a high-accuracy satellite hunt. If the fix comes back
 *  it carries the maps link, otherwise the message is sent location-less. */
export const EMERGENCY_GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 3_000,
  maximumAge: 60_000,
};

/** localStorage key for the last known GPS fix (JSON `{lat, lng}`). */
export const LAST_KNOWN_LOCATION_KEY = "last_known_location";

/**
 * Synchronous read of the cached last-known fix — the offline SOS uses this
 * INSTEAD of a fresh geolocation call, so a dead zone can never hang the
 * emergency path on a satellite hunt. Returns null when absent/corrupt.
 */
export function readLastKnownLocation(): { lat: number; lng: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (
      parsed &&
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number" &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    /* corrupt cache — treat as unknown */
  }
  return null;
}

/** Best-effort write of the latest GPS fix into the offline-SOS cache. */
export function writeLastKnownLocation(lat: number, lng: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAST_KNOWN_LOCATION_KEY,
      JSON.stringify({ lat, lng, recorded_at: new Date().toISOString() })
    );
  } catch {
    /* storage blocked — the in-memory fix still works */
  }
}

/**
 * Fire a `sms:` URI through a real DOM anchor click — the mechanism mobile
 * browsers/WebViews reliably honor for custom-scheme handles (a bare
 * `window.location.href` assignment is silently swallowed in some WebViews).
 */
export function launchSmsUri(uri: string): void {
  if (typeof document === "undefined" || !uri) return;
  const link = document.createElement("a");
  link.href = uri;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * One-shot native SMS launch — the resilient emergency action that needs
 * ZERO network. Resolves the number (stored `emergency_contact` → 112),
 * attaches the maps link when a position is known, and hands off to the
 * phone's SMS composer synchronously.
 */
export function launchEmergencySms(loc: { lat: number; lng: number } | null = null): void {
  if (typeof window === "undefined") return;
  const locationUrl = loc ? buildMapsLocationUrl(loc.lat, loc.lng) : null;
  const uri = buildSosSmsDeepLink(
    emergencySmsNumber(),
    buildEmergencySmsMessage(locationUrl)
  );
  launchSmsUri(uri || `sms:${emergencySmsNumber()}`);
}

/**
 * Coarse mobile detect for the auto-open redirect. Guarded so a walk on a
 * desktop/tablet never hijacks the app into a dead sms: handler.
 */
export function isMobileDevice(ua: string | undefined): boolean {
  if (!ua) return false;
  // iPhones don't advertise Android; iPads advertise "iPad" (or MacOS 13+).
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua);
}