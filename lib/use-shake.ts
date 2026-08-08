"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 100% offline, browser-native shake detection for emergency triggers.
 *
 * Listens to the `devicemotion` window event and computes the motion
 * magnitude from `accelerationIncludingGravity` (Manhattan norm):
 *   magnitude = |x| + |y| + |z|
 *
 * Gravity (~9.8 on one axis) never changes when the phone just sits still,
 * so a low-pass EMA of the magnitude forms a re-calibrating baseline; a
 * shove shows up as a sharp spike against that baseline, which is what we
 * count. Requires `minShakes` spikes inside `windowMs` for a confirmed shake.
 *
 * Notes:
 *  - No network, no libraries, no permissions beyond DeviceMotion.
 *  - iOS 13+ gates DeviceMotion behind `DeviceMotionEvent.requestPermission()`
 *    and only honors it inside a user gesture — see `requestPermission`.
 *  - `accelerationIncludingGravity` may be null on some engines; the event's
 *    gravity-free `acceleration` is used as a fallback.
 */

/** EMA smoothing — magnitude baseline trails the sensor, rejects jitter. */
const BASELINE_ALPHA = 0.15;

export interface ShakeDetectionOptions {
  /** Fired every time a shake is confirmed. */
  onShake?: () => void;
  /** Master switch; when false the listener stays unbound. Default true. */
  enabled?: boolean;
  /** Manhattan deviation above baseline that counts as a spike. Default 24. */
  threshold?: number;
  /** Spikes required within `windowMs` to confirm a shake. Default 3. */
  minShakes?: number;
  /** Time window (ms) spikes must fall inside. Default 900. */
  windowMs?: number;
  /** Quiet period (ms) after a confirmed shake. Default 2500. */
  cooldownMs?: number;
  /** Auto-request DeviceMotion permission where required (iOS 13+). Default true. */
  requestPermission?: boolean;
}

export interface ShakeDetection {
  /** True when the device reports motion data on this browser. */
  supported: boolean;
  /** Timestamp of the most recent confirmed shake (0 = never). */
  lastShakeAt: number;
}

const DEFAULTS = {
  threshold: 24,
  minShakes: 3,
  windowMs: 900,
  cooldownMs: 2500,
} as const;

export function useShakeDetection(options: ShakeDetectionOptions = {}): ShakeDetection {
  const {
    onShake,
    enabled = true,
    threshold = DEFAULTS.threshold,
    minShakes = DEFAULTS.minShakes,
    windowMs = DEFAULTS.windowMs,
    cooldownMs = DEFAULTS.cooldownMs,
    requestPermission = true,
  } = options;

  const [supported, setSupported] = useState(false);
  const [lastShakeAt, setLastShakeAt] = useState(0);

  // All tuning refs live in one object so the native listener is bound ONCE
  // and never resurrected when callers pass inline lambdas.
  const cfgRef = useRef({ onShake, threshold, minShakes, windowMs, cooldownMs, enabled });
  useEffect(() => {
    cfgRef.current = { onShake, threshold, minShakes, windowMs, cooldownMs, enabled };
  }, [onShake, threshold, minShakes, windowMs, cooldownMs, enabled]);

  const baselineRef = useRef(0);
  const samplesRef = useRef(0);
  const spikeTimesRef = useRef<number[]>([]);
  const quietUntilRef = useRef(0);
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    const deviceHasMotion =
      "DeviceMotionEvent" in window ||
      typeof (window as Window & { DeviceMotionEvent?: unknown }).DeviceMotionEvent === "function";
    setSupported(deviceHasMotion);
    if (!deviceHasMotion) return;

    // iOS 13+: permission is a user-gesture call. Best-effort auto-request
    // when mounted after a tap; app code can also call it ahead of time.
    const onMotion = (
      window as unknown as {
        DeviceMotionEvent?: {
          requestPermission?: () => Promise<"granted" | "denied" | "unavailable">;
        };
      }
    ).DeviceMotionEvent;
    if (
      requestPermission &&
      !permissionRequestedRef.current &&
      typeof onMotion?.requestPermission === "function"
    ) {
      permissionRequestedRef.current = true;
      void onMotion.requestPermission().catch(() => {
        /* permission rejected — hook simply never fires */
      });
    }
    return;
  }, [requestPermission]);

  useEffect(() => {
    // Bound once at mount; the handler itself consults cfgRef.enabled, so
    // toggling `enabled` never rebinds or leaks listeners.
    const handleMotion = (event: DeviceMotionEvent) => {
      const cfg = cfgRef.current;
      if (!cfg.enabled) return;
      const now = Date.now();
      if (now < quietUntilRef.current) return;

      const raw = event.accelerationIncludingGravity ?? event.acceleration;
      if (!raw) return;

      const magnitude =
        Math.abs(raw.x ?? 0) + Math.abs(raw.y ?? 0) + Math.abs(raw.z ?? 0);

      // First ~10 samples calibrate the baseline (gravity offset) — peaks
      // during this warm-up are ignored so mounting doesn't false-fire.
      const samples = samplesRef.current;
      if (samples < 10) {
        baselineRef.current = baselineRef.current * (1 - BASELINE_ALPHA) + magnitude * BASELINE_ALPHA;
        samplesRef.current = samples + 1;
        return;
      }

      const delta = Math.abs(magnitude - baselineRef.current);
      if (delta <= cfg.threshold) {
        spikeTimesRef.current = [];
        return;
      }

      // Spike confirmed — keep only spikes inside the window.
      const spikes = spikeTimesRef.current.filter((t) => now - t <= cfg.windowMs);
      spikes.push(now);
      spikeTimesRef.current = spikes;
      if (spikes.length < cfg.minShakes) return;

      // Confirmed shake: fire once, then go quiet until the cooldown ends.
      spikeTimesRef.current = [];
      quietUntilRef.current = now + cfg.cooldownMs;
      setLastShakeAt(now);
      cfg.onShake?.();
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, []);

  return { supported, lastShakeAt };
}