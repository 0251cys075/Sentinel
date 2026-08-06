"use client";

/**
 * "UP Police 112 Emergency Video Call" — a highly realistic deterrent call
 * used to unsettle a stalker/attacker. No real call is placed: Sentinel
 * plays a staged Hindi/English control-room script via the Web Speech API,
 * streams the device's front camera into a "live evidence" PiP window and
 * shows a believable 112 Dispatch UI. All hardware and speech is torn down
 * when the user declines or ends the call.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

const OFFICER_NAME = "Inspector V. Sharma";
const OFFICER_ROLE = "UP Police 112 Dispatch Control Room";
const OFFICER_AVATAR = "https://share.google/EWRlZWzaHnpRNQPB7";
/** Official Emblem of India badge — used if the custom portrait can't load. */
const OFFICER_AVATAR_FALLBACK =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Emblem_of_India.svg/300px-Emblem_of_India.svg.png";

const FALLBACK_GPS = { lat: 28.4672, lng: 77.4956, place: "Knowledge Park III" };

interface GpsStamp {
  lat: number;
  lng: number;
  place: string | null;
}

/** Multi-stage control-room audio, timed from the moment the call is accepted. */
type ScriptStage = { atMs: number; lines: string[] };
const SCRIPT: ScriptStage[] = [
  {
    atMs: 2_000,
    lines: [
      "UP Police Control Room 112. Ma'am, aapki live location system par lock ho gayi hai. Kya aap safe hain?",
    ],
  },
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

/** Speak a line through the Web Speech API (Hindi/Indian English). */
function speakLine(text: string, lang = "hi-IN") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.98; // calm, authoritative delivery
  utter.pitch = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find((v) => v.lang?.toLowerCase().startsWith("hi")) ??
    voices.find((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("en-in"));
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
}
function fmtLng(lng: number): string {
  return `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}

/**
 * Inspector portrait. Falls back to the official Emblem of India badge if the
 * custom share URL can't load (auth-gated, offline, etc.) — never a stock photo.
 */
function InspectorAvatar({ alt }: { alt: string }) {
  const [src, setSrc] = useState(OFFICER_AVATAR);
  const onError = () =>
    setSrc((prev) => (prev === OFFICER_AVATAR_FALLBACK ? prev : OFFICER_AVATAR_FALLBACK));
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- remote portrait */
    <img src={src} alt={alt} onError={onError} />
  );
}

export default function FakeCallPage() {
  const router = useRouter();
  const toast = useToast();

  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [camState, setCamState] = useState<"idle" | "live" | "denied">("idle");
  const [gps, setGps] = useState<GpsStamp>(FALLBACK_GPS);

  const webcamRef = useRef<HTMLVideoElement | null>(null);
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

  /* ── Start front camera (evidence stream) ── */
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamState("denied");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, // front camera
        audio: false,
      });
      streamRef.current = stream;
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream;
        webcamRef.current.onloadedmetadata = () => {
          webcamRef.current?.play().catch((e) => console.error("Play error:", e));
        };
      }
      setCamState("live");
    } catch {
      setCamState("denied");
    }
  }, []);

  const stopEverything = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (webcamRef.current) {
      webcamRef.current.onloadedmetadata = null;
      webcamRef.current.srcObject = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  /* ── Accept: connect camera + start the staged 112 audio script ── */
  const startCall = useCallback(async () => {
    if (callStartedRef.current) return;
    callStartedRef.current = true;
    setConnected(true);
    await startCamera();

    SCRIPT.forEach((stage) => {
      schedule(() => {
        stage.lines.forEach((line, i) => schedule(() => speakLine(line), i * 600));
      }, stage.atMs);
    });
  }, [schedule, startCamera]);

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
        {/* ── Front camera evidence stream (PiP) ── */}
        <div className="pip-wrap">
          {camState === "live" ? (
            <video
              ref={webcamRef}
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
          <div className={`pip-label${camState === "live" ? "" : " off"}`}>
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

      <div className="pb-[28px]">
        <button type="button" onClick={endCall} className="endcall-btn">
          ⏻ End Call
        </button>
      </div>
    </div>
  );
}