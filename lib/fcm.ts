"use client";

import { useEffect } from "react";
import { getFirebaseApp, getFirebaseConfig } from "@/lib/firebase";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Registers the device with FCM (on web) and stores the token row so the
 * escalation edge function can push alerts. No-op when Firebase isn't
 * configured, so the app still runs without a Firebase project.
 */
export function useFcmRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__sentinelFcmReady) return;
    const config = getFirebaseConfig();
    if (!config) return;
    window.__sentinelFcmReady = true;

    (async () => {
      try {
        if (!("Notification" in window)) return;
        // Don't spam the permission prompt until the user is on an active
        // journey — the live screen is the right moment to ask.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const app = await getFirebaseApp();
        if (!app) return;
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        }
        const { getMessaging, getToken } = await import("firebase/messaging");
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey: config.vapidKey });
        if (!token) return;

        const supabase = getSupabaseBrowser();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        await supabase
          .from("fcm_tokens")
          .upsert({ user_id: user.id, token, platform: "web" }, { onConflict: "token" });
      } catch (err) {
        // Firebase/Messaging may not be set up yet — never block the journey.
        console.error("FCM registration skipped:", err);
      }
    })();
  }, []);
}