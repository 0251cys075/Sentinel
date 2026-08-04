"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { Card } from "@/components/primitives";

const SOS_COUNTDOWN_SECONDS = 8;

function SosScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const tripId = params.get("trip") ?? "";

  const [left, setLeft] = useState(SOS_COUNTDOWN_SECONDS);
  const [primaryContacts, setPrimaryContacts] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    getSupabaseBrowser()
      .from("trusted_contacts")
      .select("name")
      .eq("tier", "primary")
      .then(({ data }) => setPrimaryContacts((data ?? []).map((c) => c.name)));
  }, []);

  const send = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setSending(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("alerts").insert({
        trip_id: tripId || null,
        user_id: user.id,
        type: "sos",
      });
      if (error) throw error;
      toast("SOS sent to your trusted circle");
      router.push("/");
    } catch (err) {
      sent.current = false;
      toast(err instanceof Error ? err.message : "Could not send SOS");
      setSending(false);
    }
  }, [tripId, router, toast]);

  /* Auto-send when the countdown reaches zero, exactly like the prototype. */
  useEffect(() => {
    const t = setInterval(() => {
      setLeft((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          void send();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [send]);

  const cancel = () => {
    sent.current = true;
    toast("SOS cancelled safely");
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

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
        onClick={send}
        disabled={sending}
        className="mt-2.5 w-full rounded-[13px] bg-primary2 px-4 py-[13px] font-bold text-primary"
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