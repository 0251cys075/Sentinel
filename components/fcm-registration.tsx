"use client";

import { useFcmRegistration } from "@/lib/fcm";

/**
 * Thin client wrapper that activates FCM token registration for the
 * current user. Rendered inside the root layout so it runs on every
 * authenticated page-load without polluting any server component.
 *
 * The hook is a no-op when:
 *   - Firebase env vars are missing
 *   - The browser doesn't support Notifications
 *   - The user has denied the permission prompt
 */
export function FcmRegistration() {
  useFcmRegistration();
  return null;
}
