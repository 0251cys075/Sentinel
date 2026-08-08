"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sentinel emergency session state — survives page refreshes.
 *
 * The three active modes map 1:1 to running emergency sessions:
 *   - FAKE_CALL / BROADCAST → the /journey/call "evidence broadcast" page
 *   - SOS                  → the /sos confirmation → confirmed workflow
 *
 * The active mode is mirrored into `sessionStorage` (`sentinel_active_mode`)
 * the instant a session starts. `sessionStorage` survives refreshes (unlike
 * component state) yet dies with the tab, so a stale emergency can never be
 * revived in a later browsing session. On mount the provider reads the key
 * and routes straight back into the interrupted screen, restoring the
 * overlay without the user having to find their way back.
 */
export type SentinelMode = "IDLE" | "FAKE_CALL" | "BROADCAST" | "SOS";

export const SENTINEL_MODE_STORAGE_KEY = "sentinel_active_mode";

/** The fake call page is a broadcast while it's live — both restore to it. */
const RESTORABLE_ACTIVE_MODES: ReadonlySet<string> = new Set([
  "FAKE_CALL",
  "BROADCAST",
]);

/** One shake = one haptic bolt, unmistakable alongside the siren. */
const TRIGGER_VIBRATION_PATTERN = [300, 150, 300, 150, 300] as const;
/** Fake call arm = short confirmatory bolt (distinct from the SOS pattern). */
const FAKE_CALL_VIBRATION_PATTERN = [200, 100, 200] as const;

interface SentinelStateContextValue {
  mode: SentinelMode;
  /** The fake call trigger — starts a broadcast session + haptic bolt. */
  triggerFakeCall: () => void;
  /** The shake / manual SOS trigger — opens an SOS session. */
  triggerSos: () => void;
  /** The broadcast page is live (called on its mount). */
  broadcastActive: () => void;
  /** Ends the active session and forgets it (cancel / End Call / Return home). */
  endSession: () => void;
}

const SentinelStateContext = createContext<SentinelStateContextValue>({
  mode: "IDLE",
  triggerFakeCall: () => undefined,
  triggerSos: () => undefined,
  broadcastActive: () => undefined,
  endSession: () => undefined,
});

function vibrate(pattern: number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* vibration unsupported */
    }
  }
}

export function SentinelProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<SentinelMode>("IDLE");

  /* Restore an interrupted session after a page refresh. Runs once at
     mount; sessionStorage also clears itself when the tab closes, so a
     restore can never fire for a stale emergency. */
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(SENTINEL_MODE_STORAGE_KEY);
    } catch {
      /* storage blocked — no restore possible */
    }
    if (!saved) return;

    if (RESTORABLE_ACTIVE_MODES.has(saved)) {
      setMode("FAKE_CALL");
      router.replace("/journey/call");
    } else if (saved === "SOS") {
      setMode("SOS");
      router.replace("/sos");
    }
  }, [router]);

  const persist = useCallback((next: SentinelMode) => {
    setMode(next);
    try {
      window.sessionStorage.setItem(SENTINEL_MODE_STORAGE_KEY, next);
    } catch {
      /* storage blocked — in-memory session still runs */
    }
  }, []);

  const triggerFakeCall = useCallback(() => {
    persist("FAKE_CALL");
    vibrate([...FAKE_CALL_VIBRATION_PATTERN]);
  }, [persist]);

  const triggerSos = useCallback(() => {
    persist("SOS");
    vibrate([...TRIGGER_VIBRATION_PATTERN]);
  }, [persist]);

  const broadcastActive = useCallback(() => {
    persist("BROADCAST");
  }, [persist]);

  const endSession = useCallback(() => {
    setMode("IDLE");
    try {
      window.sessionStorage.removeItem(SENTINEL_MODE_STORAGE_KEY);
    } catch {
      /* storage blocked — nothing to clean */
    }
  }, []);

  return (
    <SentinelStateContext.Provider
      value={{ mode, triggerFakeCall, triggerSos, broadcastActive, endSession }}
    >
      {children}
    </SentinelStateContext.Provider>
  );
}

/** Reads the current emergency session state (IDLE when none is active). */
export function useSentinelState(): SentinelStateContextValue {
  return useContext(SentinelStateContext);
}