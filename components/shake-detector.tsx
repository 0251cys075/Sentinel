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

/**
 * Mounted once in the (main) layout: turns the phone's accelerometer into a
 * real SOS trigger.
 *
 *  - A confirmed shake fires the haptic vibration + siren alarm, then
 *    bounces straight into the /sos flow (which has its own 8-second cancel
 *    window, so a bump in the pocket never sends anything).
 *  - Fully offline: the siren is precached by the service worker and the
 *    controller's Web Audio fallback needs zero assets.
 *  - Honours the "Shake-to-SOS" toggle (localStorage `sentinelShakeSos`,
 *    default ON) and never re-triggers while the SOS screen is open.
 *  - Renders a floating mute button whenever the alarm is ringing, so a
 *    siren can always be stopped instantly from any screen.
 */
export function ShakeDetector() {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(true);
  const { playing } = useSirenState();

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
    router.push("/sos");
  }, [pathname, router]);

  useShakeDetection({ enabled, onShake: handleShake });

  /* If the app shell unmounts (sign-out), kill the alarm too. */
  useEffect(() => stopSiren, []);

  if (!playing) return null;

  return (
    <button
      type="button"
      aria-label="Stop siren"
      onClick={stopSiren}
      className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-5 py-3 font-bold text-white shadow-[0_10px_30px_rgba(217,74,50,0.45)]"
    >
      🔕 Stop siren
    </button>
  );
}