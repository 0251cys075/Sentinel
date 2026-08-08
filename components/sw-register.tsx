"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js after the first paint (browser best practice — never
 * let the service worker race the initial render).
 *
 * Registered in every environment: service workers only run on HTTPS or
 * localhost, so the guard below keeps UX intact on non-secure hosts.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const { protocol, hostname } = window.location;
    const secure =
      protocol === "https:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    if (!secure) return;

const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(
          (reg) => console.log("Sentinel SW registered:", reg.scope),
          (err) => console.error("Sentinel SW registration failed:", err)
        );
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}