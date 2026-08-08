"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShakeDetection } from "@/lib/use-shake";
import {
  DEFAULT_SIREN_MS,
  stopSiren,
  triggerEmergencyAlarm,
  useSirenState,
} from "@/lib/siren";
import { useSentinelState } from "@/hooks/useSentinelState";

/**
 * Mounted once in the (main) layout: turns the phone's accelerometer into a
 * real SOS trigger.
 *
 *  - A confirmed shake fires the haptic vibration + siren alarm, marks the
 *    SOS session in persistent state (survives a page refresh) and then
 *    bounces straight into the /sos flow (which has its own 8-second cancel
 *    window, so a bump in the pocket never sends anything).
 *  - Feedback is never audio-only: the moment the siren is armed the whole
 *    screen turns into a flashing red SOS overlay, so a user always SEES the
 *    emergency even if the device speaker is silent / blocked. The siren
 *    state flips to `playing` instantly and independently of audio hardware,
 *    so the visual can never be skipped by an autoplay block.
 *  - Fully offline: the siren is precached by the service worker and the
 *    controller's Web Audio fallback needs zero assets.
 *  - Honours the "Shake-to-SOS" toggle (localStorage `sentinelShakeSos`,
 *    default ON) and never re-triggers while the SOS screen is open.
 *  - Renders a full-screen alarm overlay + mute button whenever the alarm
 *    is ringing, so a siren can always be stopped instantly from any screen.
 */
export function ShakeDetector() {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(true);
  const { playing } = useSirenState();
  const { triggerSos } = useSentinelState();

  // The shake hook is only meaningful when the user opted in; the toggle
  // lives in Settings and flips the same key the detector reads.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem("sentinelShakeSos") !== "off");
    } catch {
      /* storage blocked — keep the default */
    }
  }, []);

  /* Hardware gesture → alarm. Cooldown inside the hook (2.5s) prevents
     machine-gunning: one shake in, one SOS out. */
  const handleShake = useCallback(() => {
    // Already on the SOS screen? Don't stack another confirmation.
    if (pathname === "/sos") return;
    triggerEmergencyAlarm(DEFAULT_SIREN_MS);
    triggerSos(); // persist the session so a refresh restores this SOS
    router.push("/sos");
  }, [pathname, router, triggerSos]);

  useShakeDetection({ enabled, onShake: handleShake });

  /* If the app shell unmounts (sign-out), kill the alarm too. */
  useEffect(() => stopSiren, []);

  if (!playing) return null;

  /* Full-screen flashing red alarm — the answer to "I heard a beep but
     nothing happened". Rendered the instant the siren arms, from any
     screen, without waiting for the /sos route to load. Pointer events
     are off so the SOS cancel button stays reachable beneath. */
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-0 z-[60] flex select-none flex-col items-center justify-between bg-danger/25 px-6 py-10 backdrop-blur-[1px] animate-pulse"
    >
      <span className="rounded-full bg-danger px-5 py-2 text-[11px] font-black tracking-[0.25em] text-white uppercase shadow-[0_6px_24px_rgba(217,74,50,0.6)]">
        🚨 Emergency — SOS active
      </span>

      <div className="flex flex-col items-center gap-1 text-center text-white">
        <span className="text-[72px] leading-none drop-shadow-[0_0_24px_rgba(255,255,255,0.45)]">
          🆘
        </span>
        <span className="font-display text-[30px] font-black tracking-[0.3em]">
          SOS ACTIVE
        </span>
        <span className="text-[11px] font-bold tracking-widest text-white/90 uppercase">
          Shake alarm triggered — Sentinel is live
        </span>
      </div>

      <button
        type="button"
        aria-label="Stop siren"
        onClick={stopSiren}
        className="pointer-events-auto rounded-full bg-danger px-8 py-4 text-sm font-bold tracking-widest text-white uppercase shadow-[0_10px_30px_rgba(217,74,50,0.55)] active:scale-[0.97]"
      >
        🔕 Stop siren
      </button>
    </div>
  );
}
