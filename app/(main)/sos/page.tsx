"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { notifySosSmsDemo } from "@/lib/sos";
import { useToast } from "@/components/toast";
import { Card } from "@/components/primitives";

const SOS_COUNTDOWN_SECONDS = 8;

function SosScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const tripIdParam = params.get("trip") ?? "";

  const [left, setLeft] = useState(SOS_COUNTDOWN_SECONDS);
  const [primaryContacts, setPrimaryContacts] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    getSupabaseBrowser()
      .from("trusted_contacts")
      .select("name")
      .eq("tier", "primary")
      .then(({ data }) => setPrimaryContacts((data ?? []).map((c) => c.name)));
  }, []);

  /**
   * Pick the trip the SOS alert attaches to: the one passed via ?trip=,
   * else the user's most recent trip (any status). If the user has no
   * trips at all, create a placeholder "Emergency" trip so the alert
   * always has a trip_id to reference.
   */
  const resolveTripId = useCallback(
    async (userId: string): Promise<string> => {
      if (tripIdParam) return tripIdParam;
      const supabase = getSupabaseBrowser();
      const { data: recent } = await supabase
        .from("trips")
        .select("id")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(1);
      if (recent && recent.length) return recent[0].id;

      const now = new Date().toISOString();
      const { data: placeholder, error: tripError } = await supabase
        .from("trips")
        .insert({
          user_id: userId,
          destination_text: "Emergency",
          transit_mode: "Walk",
          eta_minutes: 0,
          buffer_minutes: 0,
          status: "escalated",
          started_at: now,
          expected_arrival_at: now,
        })
        .select("id")
        .single();
      if (tripError) {
        console.error("Placeholder trip insert failed:", tripError);
        throw tripError;
      }
      return placeholder.id;
    },
    [tripIdParam]
  );

  /** Insert the `sos` alert for the current user, then fire the demo notify. */
  const confirmSos = useCallback(async (): Promise<boolean> => {
    if (doneRef.current) return false;
    doneRef.current = true;
    setSending(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const tripId = await resolveTripId(user.id);
      const { data: alert, error } = await supabase
        .from("alerts")
        .insert({
          trip_id: tripId,
          user_id: user.id,
          type: "sos",
          status: "sent",
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) {
        console.error("SOS alert insert failed:", error);
        throw error;
      }

      notifySosSmsDemo();

      // Fire real notifications in the background — never block the success
      // screen on WhatsApp/email delivery.
      void fetch("/api/sos-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, alertId: alert.id }),
      }).catch((err) => console.error("[sos-notify] background fetch failed:", err));

      return true;
    } catch (err) {
      doneRef.current = false;
      setSending(false);
      console.error("SOS confirm failed:", err);
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string } | null)?.message ?? "unknown error";
      toast("SOS failed: " + message);
      return false;
    }
  }, [resolveTripId, toast]);

  /* Countdown — pure ticking, no side effects inside the state updater. */
  useEffect(() => {
    if (doneRef.current) return;
    const t = setInterval(() => {
      setLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Auto-fire the SOS the instant the countdown hits 00. */
  useEffect(() => {
    if (left > 0 || confirmed) return;
    void (async () => {
      const ok = await confirmSos();
      if (ok) setConfirmed(true);
    })();
    // Runs once per `left` transition; retries go through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const sendNow = useCallback(async () => {
    const ok = await confirmSos();
    if (ok) setConfirmed(true);
  }, [confirmSos]);

  const cancel = () => {
    if (doneRef.current || sending) return;
    doneRef.current = true;
    toast("SOS cancelled — you're safe.");
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

  if (confirmed) {
    return (
      <div className="sos">
        <div className="soscheck">
          <div>✓</div>
        </div>
        <div className="eyebrow !text-primary">SOS sent</div>
        <h1 className="font-display mt-2 text-[30px] font-bold leading-[1.15]">
          Help is on the way
        </h1>
        <p className="mt-3 leading-[1.6] text-muted">
          Your trusted contacts have been notified with your location.
        </p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 w-full rounded-[15px] bg-primary px-[18px] py-4 font-bold text-white shadow-[0_10px_24px_rgba(15,110,86,0.18)]"
        >
          Return home
        </button>
      </div>
    );
  }

  const names = primaryContacts.length
    ? primaryContacts.join(" and ")
    : "your trusted contacts";

  return (
    <div className="sos">
      <div className="sosring">
        <div>SOS</div>
      </div>
      <div className="eyebrow !text-danger">Ready to send</div>
      <h1 className="font-display mt-2 text-[30px] leading-[1.15]">
        Are you sure you need help?
      </h1>
      <p className="mt-3 leading-[1.6] text-muted">
        Sentinel will share your live location and journey details with {names}.
      </p>

      <Card className="my-3 text-left">
        <b>What will be sent</b>
        <p className="mt-1 text-xs leading-[1.6] text-muted">
          • Live location
          <br />• Last known route
          <br />• Emergency contact details
        </p>
      </Card>

      <button
        type="button"
        onClick={cancel}
        disabled={sending}
        className="w-full rounded-[15px] bg-danger px-[18px] py-4 font-bold text-white shadow-[0_0_0_2px_rgba(217,74,50,0.3)] disabled:opacity-60"
      >
        Cancel · {String(left).padStart(2, "0")}
      </button>
      <button
        type="button"
        onClick={sendNow}
        disabled={sending}
        className="mt-2.5 w-full rounded-[13px] bg-primary2 px-4 py-[13px] font-bold text-primary disabled:opacity-60"
      >
        {sending ? "Sending…" : "Send SOS now"}
      </button>
    </div>
  );
}

export default function SosPage() {
  return (
    <Suspense fallback={<div className="pt-20 text-center text-sm text-muted">Loading…</div>}>
      <SosScreen />
    </Suspense>
  );
}
