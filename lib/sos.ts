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
 * Coarse mobile detect for the auto-open redirect. Guarded so a walk on a
 * desktop/tablet never hijacks the app into a dead sms: handler.
 */
export function isMobileDevice(ua: string | undefined): boolean {
  if (!ua) return false;
  // iPhones don't advertise Android; iPads advertise "iPad" (or MacOS 13+).
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua);
}