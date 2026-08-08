"use client";

import { useEffect, useState } from "react";

/**
 * Sentinel siren controller — Web Audio + cached-file, global, mute-able.
 *
 * Why this file exists (three fixes in one):
 *  1. The alarm is singleton module state, not a component's local ref, so
 *     ANY screen can stop/mute it: shake detector, SOS screen, the floating
 *     mute button, logout cleanup.
 *  2. Offline silence: the siren file IS precached by the service worker,
 *     but mobile browsers gate `play()` behind a user gesture — a shake is
 *     not a gesture, so the precached file silently fails. The controller
 *     retries on the next real gesture AND falls back to a synthesized
 *     Web Audio siren (zero assets, zero network) so the alarm always sounds.
 *  3. One `triggerEmergencyAlarm()` gives online and offline SOS the same
 *     hardware response — vibration pattern + siren — then `stopSiren()`
 *     ends both.
 */

const SIREN_URL = "/sounds/siren.wav";
/** Default alarm length (shake). */
export const DEFAULT_SIREN_MS = 12_000;
/** Alarm burst when an SOS is actually confirmed. */
export const SOS_BURST_MS = 6_000;
/** Haptic burst fired with every alarm. */
const ALARM_VIBRATION_PATTERN = [500, 200, 500, 200, 500] as const;

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let synthStop: (() => void) | null = null;
let stopTimer: number | null = null;
let playing = false;

const listeners = new Set<(p: boolean) => void>();

function setPlaying(p: boolean) {
  if (p === playing) return;
  playing = p;
  listeners.forEach((l) => l(p));
}

/** Subscribe to siren on/off changes; returns the unsubscribe fn. */
export function onSirenChange(listener: (p: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSirenPlaying(): boolean {
  return playing;
}

/* ── Low-level audio plumbing ── */

function spawnAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

/** Retry on the next real user gesture — a shake is NOT one. */
function unlockOnGesture() {
  const unlock = () => {
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("touchend", unlock, { capture: true });
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("touchend", unlock, { capture: true });
}

/**
 * Synthesized siren (two detuned triangles + tremolo warble) — the
 * zero-network fallback when the browser blocks the precached wav.
 */
function ensureSynthSiren() {
  if (audioCtx || synthStop) return; // already singing
  const ctx = spawnAudioContext();
  if (!ctx) return;
  audioCtx = ctx;

  const master = ctx.createGain();
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const tremolo = ctx.createOscillator();
  const tremoloGain = ctx.createGain();

  oscA.type = "triangle";
  oscA.frequency.value = 625;
  oscB.type = "sine";
  oscB.frequency.value = 660; // detune → the bleating edge
  tremolo.type = "sine";
  tremolo.frequency.value = 3.2; // warble rate ≈ classic siren
  tremoloGain.gain.value = 110; // ±110 Hz sweep
  tremolo.connect(tremoloGain);
  tremoloGain.connect(oscA.frequency);

  master.gain.value = 0;
  oscA.connect(master);
  oscB.connect(master);
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.15);

  oscA.start();
  oscB.start();
  tremolo.start();

  if (ctx.state === "suspended") unlockOnGesture();

  synthStop = () => {
    try {
      oscA.stop();
      oscB.stop();
      tremolo.stop();
      master.disconnect();
    } catch {
      /* already stopped */
    }
    void ctx.close().catch(() => undefined);
    audioCtx = null;
    synthStop = null;
  };
}

function teardownSynth() {
  if (synthStop) {
    synthStop();
    synthStop = null;
  }
}

function teardownElement() {
  if (audioEl) {
    audioEl.pause();
    audioEl.currentTime = 0;
  }
}

function vibratePattern() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([...ALARM_VIBRATION_PATTERN]);
    } catch {
      /* vibration unsupported */
    }
  }
}

/* ── Public controller API ── */

/** Hard, immediate stop — pause + rewind + cancel vibration. */
export function stopSiren(): void {
  if (stopTimer !== null) {
    window.clearTimeout(stopTimer);
    stopTimer = null;
  }
  teardownElement();
  teardownSynth();
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(0); // cancel any in-progress haptic
    } catch {
      /* ignore */
    }
  }
  setPlaying(false);
}

/**
 * Start (or re-arm) the siren. Plays the precached wav; whenever the
 * browser refuses autoplay, swaps to the synthesized Web Audio siren and
 * retries on the next user gesture. Auto-stops after `durationMs`.
 */
export function playSiren(durationMs = DEFAULT_SIREN_MS) {
  if (typeof window === "undefined") return;
  setPlaying(true);

  try {
    audioEl = audioEl ?? new Audio(SIREN_URL);
    audioEl.loop = true;
    audioEl.volume = 1;
    const attempt = audioEl.play();
    if (attempt !== undefined) {
      attempt.catch(() => {
        if (!playing) return;
        teardownElement();
        ensureSynthSiren();
      });
    }
    audioEl.onerror = () => {
      if (!playing) return;
      teardownElement();
      ensureSynthSiren();
    };
  } catch {
    ensureSynthSiren();
  }

  if (stopTimer !== null) window.clearTimeout(stopTimer);
  stopTimer = window.setTimeout(stopSiren, durationMs);
}

/** One call every SOS path uses — identical vibration + siren, online or off. */
export function triggerEmergencyAlarm(durationMs = SOS_BURST_MS) {
  vibratePattern();
  playSiren(durationMs);
}

/** React mirror of the controller state. */
export function useSirenState(): { playing: boolean } {
  const [state, setState] = useState(isSirenPlaying);
  useEffect(() => onSirenChange(setState), []);
  return { playing: state };
}