"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShakeDetection } from "@/lib/use-shake";

/** Offline-ready siren (precached by the service worker). */
const SIREN_URL = "/sounds/siren.wav";
/** How long the siren rings after a shake (ms). */
const SIREN_DURATION_MS = 12_000;
/** Haptic burst fired together with the siren. */
const SIREN_VIBRATION_PATTERN = [500, 200, 500, 200, 500] as const;

/**
 * Mounted once in the (main) layout: turns the phone's accelerometer into a
 * real SOS trigger.
 *
 *  - A confirmed shake fires the haptic vibration pattern, loops the siren
 *    alarm, then bounces straight into the /sos flow (which has its own
 *    8-second cancel window, so a bump in the pocket never sends anything).
 *  - Works fully offline: the siren is precached by the service worker and
 *    no network call is made.
 *  - Honours the "Shake-to-SOS" toggle (localStorage `sentinelShakeSos`,
 *    default ON) and never re-triggers while the SOS screen is already open.
 */
export function ShakeDetector() {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(true);

  // The shake hook is only meaningful when the user opted in; the toggle
  // lives in Settings and flips the same key the detector reads.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem("sentinelShakeSos") !== "off");
    } catch {
      /* storage blocked — keep the default */
    }
  }, []);

  const sirenRef = useRef<HTMLAudioElement | null>(null);
  const sirenTimerRef = useRef<number | null>(null);

  const stopSiren = useCallback(() => {
    if (sirenTimerRef.current !== null) {
      window.clearTimeout(sirenTimerRef.current);
      sirenTimerRef.current = null;
    }
    const audio = sirenRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const playSiren = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const audio = sirenRef.current ?? new Audio(SIREN_URL);
      // Looping gives the attacker a continuous alarm, not a one-shot blip.
      audio.loop = true;
      audio.volume = 1;
      sirenRef.current = audio;
      void audio.play().catch(() => {
        // Autoplay policy / muted device — vibration + SOS still fire.
      });
    } catch {
      /* audio unavailable — vibration + SOS still fire */
    }
    if (sirenTimerRef.current !== null) window.clearTimeout(sirenTimerRef.current);
    sirenTimerRef.current = window.setTimeout(stopSiren, SIREN_DURATION_MS);
  }, [stopSiren]);

  /* Hardware gesture → alarm. Cooldown inside the hook (2.5s) prevents
     machine-gunning: one shake in, one SOS out. */
  const handleShake = useCallback(() => {
    // Already on the SOS screen? Don't stack another confirmation.
    if (pathname === "/sos") return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([...SIREN_VIBRATION_PATTERN]);
      } catch {
        /* vibration unsupported — siren + SOS still fire */
      }
    }
    playSiren();
    router.push("/sos");
  }, [pathname, router, playSiren]);

  useShakeDetection({ enabled, onShake: handleShake });

  /* Stop the siren if the user leaves the app shell. */
  useEffect(() => stopSiren, [stopSiren]);

  return null;
}