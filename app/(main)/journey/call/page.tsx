"use client";

/**
 * "UP Police 112 Emergency Evidence Broadcast" — a high-deterrent, mobile
 * optimized interface that makes an attacker believe the phone is live-streaming
 * evidence to the UP Police 112 Control Room. No real call is placed: Sentinel
 * requests the front camera immediately, plays an authoritative Hindi police
 * script via the Web Speech API and shows a believable dispatch UI. All
 * hardware and speech is torn down on End Call / unmount.
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

/* Spec demo fix: NOIDA 28.4670° N, 77.4957° E (live GPS overrides when granted). */
const FALLBACK_GPS = { lat: 28.467, lng: 77.4957, place: "Noida" };

interface GpsStamp {
  lat: number;
  lng: number;
  place: string | null;
}

/** Follow-up control-room audio (the opener runs through speakPoliceOfficerVoice). */
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
      "PCR Van 104 aur Local Patrol Unit Noida se bas 60 seconds ki doori par hain.",
      "Suspect ki photo aur coordinates record ho rahe hain. Phone mat kaatna!",
    ],
  },
];

/**
 * Voice gender is NOT exposed by the platform APIs (Google / Microsoft /
 * macOS all omit it), so the officer picker uses name + language heuristics
 * with an explicit FEMALE blocklist. The blocklist is what makes the voice
 * consistent laptop→mobile: without it a laptop picks "Google UK English
 * Female" while the phone picks "Microsoft Hemant".
 */
const OFFICER_MALE_HINTS = [
  "male",
  "hemant",
  "ravi",
  "madhur",
  "prabhat",
  "arun",
  "david",
  "daniel",
  "george",
  "gordon",
  "alex",
  "fred",
  "google us english",
  "google hindi",
  "google हिन्दी",
];
const OFFICER_FEMALE_MARKS = [
  "female",
  "zira",
  "hazel",
  "susan",
  "karen",
  "moira",
  "tessa",
  "aria",
  "jenny",
  "libby",
  "sonia",
  "kiran",
  "dhwani",
  "neerja",
  "swara",
  "lekha",
  "kendra",
  "victoria",
];

/** Male-officer match: never a known female profile, never a neutral pick. */
function isMaleOfficerVoice(v: SpeechSynthesisVoice): boolean {
  const name = v.name.toLowerCase();
  if (OFFICER_FEMALE_MARKS.some((mark) => name.includes(mark))) return false;
  return OFFICER_MALE_HINTS.some((hint) => name.includes(hint));
}

/** Highest-priority male voice: Indian male → any Indian → any male. */
function pickOfficerVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const isIndian = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase();
    const name = v.name.toLowerCase();
    return (
      lang.startsWith("hi") ||
      lang.includes("en-in") ||
      name.includes("india") ||
      name.includes("hindi")
    );
  };
  return (
    voices.find((v) => isIndian(v) && isMaleOfficerVoice(v)) ??
    voices.find(isIndian) ??
    voices.find(isMaleOfficerVoice) ??
    null
  );
}

/**
 * Speak through the guaranteed male-officer voice. Every line of the
 * broadcast (opener AND staged script) routes through here so laptop and
 * mobile always read with the same voice. The low pitch survives even the
 * default-voice fallback, so it can never sound like "Google Zira" either.
 */
function speakWithOfficerVoice(
  text: string,
  lang = "hi-IN",
  rate = 0.9,
  pitch = 0.8
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.pitch = pitch; // deep, authoritative — male even on default voices

  const apply = () => {
    const voice = pickOfficerVoice(window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length > 0) {
    apply();
  } else {
    // Voice list loads async on some engines — wait for it, with a hard
    // timeout so a never-firing voiceschanged can't silently drop the line.
    const onVoices = () => {
      window.speechSynthesis.onvoiceschanged = null;
      apply();
    };
    window.speechSynthesis.onvoiceschanged = onVoices;
    window.setTimeout(() => {
      if (window.speechSynthesis.onvoiceschanged === onVoices) {
        window.speechSynthesis.onvoiceschanged = null;
        apply();
      }
    }, 250);
  }
}

/** Follow-up control-room line — natural pace, still the officer's voice. */
function speakLine(text: string, lang = "hi-IN") {
  speakWithOfficerVoice(text, lang, 0.92, 0.85);
}

/**
 * Deep authoritative Indian MALE police voice — the broadcast opener. Cancels
 * any prior speech and speaks on the same picker every device uses, so mobile
 * and laptop deliver the identical voice.
 */
function speakPoliceOfficerVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  speakWithOfficerVoice(
    "Suno! UP Police Control Room 112. Ma'am, aapki live GPS location lock ho gayi hai. Knowledge Park III ke pass PCR Van 104 bas 30 seconds door hai. Phone ka camera suspect ki taraf ghoomayein!",
    "hi-IN",
    0.88,
    0.8
  );
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
}
function fmtLng(lng: number): string {
  return `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}

/**
 * Officer portrait. Primary is the official Emblem of India badge inside a
 * golden ring; if even that fails, the inline data-URI badge kicks in —
 * never an external stock photo.
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

  const [elapsed, setElapsed] = useState(0);
  const [camState, setCamState] = useState<"idle" | "live" | "denied">("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [gps, setGps] = useState<GpsStamp>(FALLBACK_GPS);

  const streamRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<number[]>([]);
  const gpsWatchRef = useRef<number | null>(null);
  const speechKickedRef = useRef(false);

  /* ── Request front camera IMMEDIATELY on page load ── */
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

  /* ── Live dynamic GPS stamp (falls back to the Noida demo fix) ── */
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

  /* ── Kick off the police TTS broadcast + staged follow-ups ── */
  const kickOffSpeech = useCallback(() => {
    if (speechKickedRef.current) return;
    speechKickedRef.current = true;
    schedule(() => speakPoliceOfficerVoice(), 1_200);
    SCRIPT.forEach((stage) => {
      schedule(() => {
        stage.lines.forEach((line, i) => schedule(() => speakLine(line), i * 600));
      }, stage.atMs);
    });
  }, [schedule]);

  useEffect(() => {
    kickOffSpeech();
    // Some browsers block speechSynthesis.speak() until the user has
    // interacted — retry on the first pointer/touch/click if needed.
    const retry = () => {
      if (!speechKickedRef.current) kickOffSpeech();
    };
    window.addEventListener("pointerdown", retry, { once: true });
    return () => {
      window.removeEventListener("pointerdown", retry);
      // Clear scheduled script timers (real teardown also clears them).
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, [kickOffSpeech]);

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

  /* ── End broadcast: hard cleanup → dashboard with success toast ── */
  const endCall = useCallback(() => {
    stopEverything();
    toast("Broadcast ended — you're safe. Sentinel is watching.");
    router.push("/");
  }, [stopEverything, router, toast]);

  // Full hardware + audio teardown if the route unmounts (back nav, etc.).
  useEffect(() => () => stopEverything(), [stopEverything]);

  /* ── Live MM:SS session timer ── */
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const gpsText = `GPS LOCKED • ${fmtLat(gps.lat)}, ${fmtLng(gps.lng)}${
    gps.place ? ` • ${gps.place}` : ""
  } • NOIDA PATROL UNIT DISPATCHED`;

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col justify-between overflow-y-auto border-2 border-red-600 bg-slate-950 px-4 pb-24 pt-6 font-sans text-white animate-pulse shadow-[0_0_30px_rgba(220,38,38,0.5)]">
      {/* ── Row 1: pills + digital timer ── */}
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col items-start gap-0.5">
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase">
            🔴 LIVE BROADCAST
          </span>
          <span className="text-[8px] tracking-wider text-red-300 uppercase">
            RED ALERT BROADCAST
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
            {mm}:{ss}
          </span>
          <span className="text-[8px] tracking-wider text-slate-400 uppercase">
            SESSION LOG: SENTINEL PROTOCOL 112
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase">
            🛡️ ENCRYPTED
          </span>
          <span className="text-[8px] tracking-wider text-teal-300 uppercase">
            ENCRYPTED UPLOAD TO CONTROL ROOM
          </span>
        </div>
      </div>

      {/* ── Row 2: GPS lock badge ── */}
      <div className="my-1 flex justify-center">
        <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1 text-center font-mono text-[10px]">
          📡 {gpsText}
        </div>
      </div>

      {/* ── Webcam evidence stream: locked 16:9 (4:3 on desktop) box, feed
             fills via object-cover — identical structure on mobile & laptop ── */}
      <div className="relative mx-auto my-8 aspect-[16/9] w-full max-w-2xl overflow-hidden rounded-3xl border border-red-500/30 bg-black/80 shadow-[0_0_60px_-10px_rgba(239,68,68,0.3)] md:aspect-[4/3]">
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
            className="h-full w-full rounded-3xl object-cover -scale-x-100"
          />
        ) : camState === "denied" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black px-2 text-center text-[8.5px] leading-tight text-red-400">
            <span>⚠️ Camera Access Blocked.</span>
            <span className="text-white/50">
              Click the camera icon in your address bar to enable video feed.
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-black text-[9px] text-white/60">
            📷 Starting camera…
          </div>
        )}

        {/* Status overlays in top right of video container */}
        <div className="pointer-events-none absolute top-4 right-4 z-10 flex flex-col items-end gap-1.5">
          <span className="rounded-lg border border-red-500/40 bg-black/70 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-red-400 uppercase backdrop-blur-sm">
            FACIAL CAPTURE ACTIVE
          </span>
          <span className="rounded-lg border border-emerald-500/40 bg-black/70 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-emerald-400 uppercase backdrop-blur-sm">
            GEOLOCATION LOGGED
          </span>
        </div>
      </div>

      {/* ── Officer card: metallic emblem badge ── */}
      <div className="flex flex-col items-center gap-1.5 py-2">
        <InspectorAvatar alt={OFFICER_NAME} />
        <h1 className="text-lg font-bold tracking-wide">{OFFICER_NAME}</h1>
        <p className="text-[11px] text-slate-300">{OFFICER_ROLE}</p>
        <span className="text-[10px] text-teal-300">🔒 Secure — suspect footage being recorded</span>
      </div>

      {/* ── Bottom: dispatch banner + End Call (above app bottom nav) ── */}
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-red-500/40 bg-red-700/80 px-3 py-2 text-center font-mono text-[10px] font-bold tracking-wide text-white">
          🔴 POLICE DISPATCH ACTIVE • SUSPECT EVIDENCE STREAMED TO CONTROL ROOM
        </div>
        <button
          type="button"
          onClick={endCall}
          className="w-full rounded-xl border border-red-400/40 bg-gradient-to-b from-red-600 to-red-700 py-3.5 text-sm font-bold tracking-widest uppercase shadow-lg shadow-red-600/30 active:scale-[0.98]"
        >
          ⏻ End Broadcast
        </button>
      </div>
    </div>
  );
}
