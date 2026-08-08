"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js after the first paint (browser best practice — never
 * let the service worker race the initial render). Survives production
 * only: dev must serve the app with a registered worker, so we scope it
 * to the `production` phase to avoid breaking hot reload.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.error("[sw] registration failed:", err));
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}