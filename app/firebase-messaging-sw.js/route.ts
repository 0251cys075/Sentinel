import { getFirebaseConfig } from "@/lib/firebase";

/**
 * Serves firebase-messaging-sw.js with the project's Firebase config
 * injected at request time (public files can't read env vars).
 * Requested by the app at /firebase-messaging-sw.js.
 */
export async function GET() {
  const config = getFirebaseConfig();

  const swSource = config
    ? `
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: ${JSON.stringify(config.apiKey)},
  authDomain: ${JSON.stringify(config.authDomain)},
  projectId: ${JSON.stringify(config.projectId)},
  messagingSenderId: ${JSON.stringify(config.messagingSenderId)},
  appId: ${JSON.stringify(config.appId)}
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || data.title || "Sentinel";
  const body = (payload.notification && payload.notification.body) || data.body || "A safety update for you.";
  self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || "sentinel",
    data: { url: data.url || "/" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(url));
});
`.trim()
    : `
// Firebase Cloud Messaging is not configured for this deployment.
// Set NEXT_PUBLIC_FIREBASE_* in .env.local and restart to enable push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
`.trim();

  return new Response(swSource, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    },
  });
}
