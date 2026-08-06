"use client";

/**
 * "UP Police 112 Emergency Video Call" — a highly realistic deterrent call
 * used to unsettle a stalker/attacker. No real call is placed: Sentinel plays
 * a staged Hindi/English control-room script via the Web Speech API, streams
 * the device's front camera into a "live evidence" PiP window and shows a
 * believable 112 Dispatch UI. All hardware and speech is torn down when the
 * user declines or ends the call.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

const OFFICER_NAME = "Inspector V. Sharma";
const OFFICER_ROLE = "UP Police 112 Dispatch Control Room";

/** Official Emblem of India badge — the primary officer portrait. */
const OFFICER_AVATAR =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Emblem_of_India.svg/512px-Emblem_of_India.svg.png";

/**
 * Inline UP Police badge (data URI) — the final safety net so a broken/failed
 * <img> request can never fall back to an external stock photo.
 */
const OFFICER_AVATAR_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#0b3a8f"/><path d="M60 14l34 12v26c0 22-14 40-34 52-20-12-34-30-34-52V26z" fill="#ff9800" stroke="#fff" stroke-width="3"/><circle cx="60" cy="46" r="11" fill="#0b3a8f"/><path d="M60 38l3.6 7 7.9 1.1-5.7 5.6 1.4 7.8-7.2-3.8-7.2 3.8 1.4-7.8-5.7-5.6 7.9-1.1z" fill="#ff9800"/><text x="60" y="98" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#fff">UP POLICE</text></svg>`
  );

const FALLBACK_GPS = { lat: 28.4672, lng: 77.4956, place: "Knowledge Park III" };

interface GpsStamp {
  lat: number;
  lng: number;
  place: string | null;
}

/**
 * Multi-stage control-room audio, timed from the moment the call is accepted.
 * The opening line is spoken by speakPoliceOfficerVoice() at 2s; these follow-ups
 * run through speakLine().
 */
type ScriptStage = { atMs: number; lines: string[] };
const SCRIPT: ScriptStage[] = [
  {
    atMs: 12_000,
    lines: [
      "Suno! Aapke peeche jo vyakti hai, phone ka camera seedha unki taraf ghumaiye.",
      "Control Room screen par feed live chal raha hai.",
    ],
  },
  {
    atMs: 25_000,
    lines: [
      "PCR Van 104 aur Local Patrol Unit Knowledge Park se bas 60 seconds ki doori par hain.",
      "Suspect ki photo aur coordinates record ho rahe hain. Phone mat kaatna!",
    ],
  },
];

/** Speak a line through the Web Speech API (natural Hindi/Indian English). */
function speakLine(text: string, lang = "hi-IN") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  // Dynamic voice filter: prefer a human-sounding Hindi/Indian voice.
  const humanVoice = voices.find(
    (v) =>
      v.lang?.includes("hi") ||
      v.name.includes("Google") ||
      v.name.includes("India") ||
      v.name.includes("Natural")
  );
  if (humanVoice) utter.voice = humanVoice;
  utter.rate = 0.92; // natural speaking pace
  utter.pitch = 0.95; // authoritative police tone
  window.speechSynthesis.speak(utter);
}

/**
 * Deep authoritative Indian MALE police voice — the call opener. Explicitly
 * avoids the browser's default TTS: targets Indian male voice profiles
 * (Google Hindi, Microsoft Hemant / Ravi, or hi-IN / en-IN) with a firm,
 * low-pitched delivery.
 */
function speakPoliceOfficerVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    "Suno! UP Police Control Room 112. Ma'am, aapki live GPS location lock ho gayi hai. Knowledge Park III ke pass PCR Van 104 bas 30 seconds door hai. Phone ka camera suspect ki taraf ghoomayein!"
  );
  utterance.lang = "hi-IN";

  const loadVoicesAndSpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    // Search for Indian Male voice profiles (Google Hindi, Microsoft Hemant, or hi-IN)
    const maleIndianVoice =
      voices.find(
        (v) =>
          (v.lang.includes("hi") || v.lang.includes("en-IN")) &&
          (v.name.includes("Male") ||
            v.name.includes("Hemant") ||
            v.name.includes("Google") ||
            v.name.includes("Ravi"))
      ) || voices.find((v) => v.lang.includes("hi-IN"));

    if (maleIndianVoice) utterance.voice = maleIndianVoice;

    utterance.rate = 0.88; // Firm, deliberate police tone
    utterance.pitch = 0.82; // Lower, deeper male pitch

    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length > 0) {
    loadVoicesAndSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      loadVoicesAndSpeak();
      window.speechSynthesis.onvoiceschanged = null; // speak once
    };
  }
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
}
function fmtLng(lng: number): string {
  return `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}

/**
 * Officer portrait. Primary is the official Emblem of India badge; if even that
 * fails to load, the inline data-URI badge kicks in — never an external stock photo.
 */
function InspectorAvatar({ alt }: { alt: string }) {
  const [src, setSrc] = useState(OFFICER_AVATAR);
  const onError = () =>
    setSrc((prev) => (prev === OFFICER_AVATAR_FALLBACK ? prev : OFFICER_AVATAR_FALLBACK));
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- remote portrait */
    <img
      src={src}
      alt={alt}
      onError={onError}
      className="mx-auto h-28 w-28 rounded-full border-2 border-amber-500/70 bg-slate-900 object-contain p-4 shadow-lg shadow-amber-500/20"
    />
  );
}

export default function FakeCallPage() {
  const router = useRouter();
  const toast = useToast();

  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [camState, setCamState] = useState<"idle" | "live" | "denied">("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [gps, setGps] = useState<GpsStamp>(FALLBACK_GPS);

  const streamRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<number[]>([]);
  const gpsWatchRef = useRef<number | null>(null);
  const callStartedRef = useRef(false);

  /* ── Live dynamic GPS stamp (falls back to the demo Knowledge Park fix) ── */
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          place: null, // real fix — drop the demo locality label
        }),
      () => {
        /* keep demo coords on denial */
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 5_000 }
    );
    return () => {
      if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current);
    };
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  /* ── Request front camera IMMEDIATELY on page load ──
     The stream lands in React state; the <video> callback ref binds it the
     moment the active-call PiP mounts, so the feed is never a black box. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCamState("denied");
          return;
        }
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }, // front camera
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setCamState("live");
      } catch {
        if (!cancelled) setCamState("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopEverything = useCallback(() => {
    // 1. Stop every camera track (kills the red camera LED too).
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    // 2. Drop the stream from state — the video callback ref rebinds to null.
    setStream(null);
    // 3. Halt any queued/ongoing speech.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    // 4. Clear every scheduled script/dialogue timer.
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  /* ── Accept: connect the staged 112 audio script (camera already live) ── */
  const startCall = useCallback(() => {
    if (callStartedRef.current) return;
    callStartedRef.current = true;
    setConnected(true);

    schedule(() => speakPoliceOfficerVoice(), 2_000);
    SCRIPT.forEach((stage) => {
      schedule(() => {
        stage.lines.forEach((line, i) => schedule(() => speakLine(line), i * 600));
      }, stage.atMs);
    });
  }, [schedule]);

  /* ── Decline / End: hard cleanup → dashboard with success toast ── */
  const endCall = useCallback(() => {
    stopEverything();
    toast("Call ended — you're safe. Sentinel is watching.");
    router.push("/");
  }, [stopEverything, router, toast]);

  // Full hardware + audio teardown if the route unmounts (back nav, etc.).
  useEffect(() => () => stopEverything(), [stopEverything]);

  /* ── Active call MM:SS timer ── */
  useEffect(() => {
    if (!connected) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [connected]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const gpsText = `GPS LOCKED • ${fmtLat(gps.lat)}, ${fmtLng(gps.lng)}${
    gps.place ? ` (${gps.place})` : ""
  }`;

  /* ── Incoming call phase ─────────────────────────────────────── */
  if (!connected) {
    return (
      <div className="police-call">
        <div className="flex w-full flex-col items-center gap-2.5 px-5 pt-4">
          <div className="flex w-full items-center justify-between">
            <span className="live-pill">🔴 LIVE BROADCAST TO 112 CONTROL ROOM</span>
            <span className="secure-tag">🛡 ENCRYPTED</span>
          </div>
          <span className="gps-stamp">📡 {gpsText}</span>
        </div>

        <div className="flex grow flex-col items-center justify-center px-6">
          <div className="police-avatar">
            <span className="pulse-ring" />
            <InspectorAvatar alt={OFFICER_NAME} />
          </div>
          <h1 className="police-name">{OFFICER_NAME}</h1>
          <p className="police-role">{OFFICER_ROLE}</p>
          <span className="secure-tag">📹 Incoming Secure Video Call</span>
        </div>

        <div className="flex w-full items-center justify-around pb-[28px]">
          <div className="text-center">
            <button type="button" aria-label="Decline call" onClick={endCall} className="callaction end">
              ✕
            </button>
            <small className="mt-1.5 block text-[11px] text-white/60">Decline</small>
          </div>
          <div className="text-center">
            <button
              type="button"
              aria-label="Accept call"
              onClick={startCall}
              className="callaction accept"
            >
              📹
            </button>
            <small className="mt-1.5 block text-[11px] text-white/60">Accept &amp; Start Video</small>
          </div>
        </div>
      </div>
    );
  }

  /* ── Active call phase ───────────────────────────────────────── */
  return (
    <div className="police-call">
      <div className="flex w-full flex-col items-center gap-2.5 px-5 pt-4">
        <div className="flex w-full items-center justify-between">
          <span className="live-pill">🔴 LIVE</span>
          <div className="call-timer" aria-label="Call duration">
            {mm}:{ss}
          </div>
          <span className="secure-tag">🛡 ENCRYPTED</span>
        </div>
        <span className="gps-stamp">📡 {gpsText}</span>
      </div>

      <div className="relative flex grow flex-col items-center justify-center px-6">
        {/* ── Front camera evidence stream (self-attaching PiP node) ── */}
        <div className="absolute top-16 right-4 z-20 h-44 w-32 overflow-hidden rounded-2xl border-2 border-emerald-500 bg-black shadow-2xl">
          {camState === "live" ? (
            <video
              ref={(node) => {
                if (node && stream) {
                  node.srcObject = stream;
                  node.play().catch(() => {});
                }
              }}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : camState === "denied" ? (
            <div className="pip-blocked">
              ⚠️ Camera Access Blocked.
              <span>Click the camera icon in your address bar to enable video feed.</span>
            </div>
          ) : (
            <div className="pip-fallback">📷 Starting camera…</div>
          )}
          <div
            className={`absolute inset-x-0 bottom-0 py-0.5 text-center font-mono text-[9px] font-bold${
              camState === "live" ? " bg-emerald-500 text-black" : " bg-red-500 text-white"
            }`}
          >
            {camState === "live" ? "EVIDENCE STREAM TRANSMITTED" : "VIDEO FEED BLOCKED"}
          </div>
        </div>

        <div className="police-avatar">
          <span className="pulse-ring" />
          <InspectorAvatar alt={OFFICER_NAME} />
        </div>
        <h1 className="police-name">{OFFICER_NAME}</h1>
        <p className="police-role">{OFFICER_ROLE}</p>
        <span className="secure-tag">🔒 Secure — suspect footage being recorded</span>
      </div>

      <div className="w-full px-4 pb-4">
        <div className="rounded-lg border border-red-500/40 bg-red-700/80 px-3 py-2 text-center font-mono text-[10.5px] font-bold tracking-wide text-white">
          🔴 POLICE DISPATCH ACTIVE • SUSPECT EVIDENCE STREAMED TO CONTROL ROOM
        </div>
      </div>

      <div className="pb-[28px]">
        <button type="button" onClick={endCall} className="endcall-btn">
          ⏻ End Call
        </button>
      </div>
    </div>
  );
}
