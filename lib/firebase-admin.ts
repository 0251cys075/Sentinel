import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

/**
 * Server-side Firebase Admin SDK — the privileged client used to send
 * high-priority FCM push notifications. Separate from the client-side
 * Firebase SDK (lib/firebase.ts) and from the Supabase edge function
 * sender (supabase/functions/_shared/fcm.ts), so SOS pushes can be sent
 * directly from the Next.js API route.
 *
 * Config comes from the FIREBASE_ADMIN_* env vars (service account):
 *   Firebase console → Project settings → Service accounts → Generate key.
 *
 * Returns null when not configured so the app still builds and runs in a
 * fresh checkout — set the env vars to enable pushes.
 */
export function getFirebaseAdmin(): App | null {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[firebase-admin] FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY not configured — FCM pushes disabled"
    );
    return null;
  }

  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  if (existing) return existing;

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // .env values often arrive with literal \n sequences (e.g. from a
      // .env file or Vercel) — normalize to real newlines.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

/** Admin Messaging instance, or null when the Admin SDK isn't configured. */
export function getFirebaseMessaging(): Messaging | null {
  const app = getFirebaseAdmin();
  if (!app) return null;
  return getMessaging(app);
}
