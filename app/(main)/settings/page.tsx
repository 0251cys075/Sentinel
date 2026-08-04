"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { ThemeToggle } from "@/components/shell";
import { Card, DemoBadge, Switch } from "@/components/primitives";

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const { resolvedTheme, setTheme } = useTheme();

  const [contactCount, setContactCount] = useState(0);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [tripCount, setTripCount] = useState(0);
  const [locOn, setLocOn] = useState(true);
  const [smsOn, setSmsOn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    setLocOn(localStorage.getItem("sentinelLoc") !== "off");
    setSmsOn(localStorage.getItem("sentinelSmsFallback") === "on");

    supabase
      .from("trusted_contacts")
      .select("verified")
      .then(({ data }) => {
        const list = data ?? [];
        setContactCount(list.length);
        setVerifiedCount(list.filter((c) => c.verified).length);
      });
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setTripCount(count ?? 0));
  }, []);

  const toggleLocation = useCallback(() => {
    const next = !(localStorage.getItem("sentinelLoc") !== "off");
    localStorage.setItem("sentinelLoc", next ? "on" : "off");
    setLocOn(next);
    toast(next ? "Location sharing on" : "Location sharing paused");
  }, [toast]);

  const toggleSms = useCallback(() => {
    const next = !(localStorage.getItem("sentinelSmsFallback") === "on");
    localStorage.setItem("sentinelSmsFallback", next ? "on" : "off");
    setSmsOn(next);
    toast(
      next
        ? "SMS fallback armed (demo path — Twilio not wired)"
        : "SMS fallback off"
    );
  }, [toast]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    await getSupabaseBrowser().auth.signOut();
    router.push("/landing");
    router.refresh();
  }, [router]);

  const dark = resolvedTheme === "dark";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="eyebrow">Control center</div>
          <h2 className="font-display text-xl">Settings</h2>
        </div>
        <ThemeToggle />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line py-[15px]">
          <div>
            <b>Night Watch mode</b>
            <br />
            <small className="text-muted">Use the dark night-watch palette</small>
          </div>
          <Switch on={dark} onClick={() => setTheme(dark ? "light" : "dark")} />
        </div>

        <Link href="/contacts" className="flex items-center justify-between border-b border-line py-[15px]">
          <div>
            <b>Trusted contacts</b>
            <br />
            <small className="text-muted">
              {contactCount} contacts · {verifiedCount} verified
            </small>
          </div>
          <span className="text-muted">›</span>
        </Link>

        <div className="flex items-center justify-between border-b border-line py-[15px]">
          <div>
            <b>Trip history</b>
            <br />
            <small className="text-muted">{tripCount} journeys so far</small>
          </div>
          <span className="text-muted">›</span>
        </div>

        <div className="flex items-center justify-between py-[15px]">
          <div>
            <b>Location sharing</b>
            <br />
            <small className="text-muted">Only during active journeys</small>
          </div>
          <Switch on={locOn} onClick={toggleLocation} />
        </div>
      </Card>

      <Card className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <b className="flex items-center gap-2">
              SMS fallback
              <DemoBadge text="Demo path — no Twilio wired" />
            </b>
            <small className="block text-muted">
              If FCM is unreachable, escalation messages can fall back to SMS.
              The code path exists here but requires a Twilio account to go
              live.
            </small>
          </div>
          <Switch on={smsOn} onClick={toggleSms} />
        </div>
      </Card>

      <Card className="mt-3">
        <div className="flex items-center gap-2.5">
          <span className="brandmark">◈</span>
          <b className="font-display">Sentinel</b>
        </div>
        <p className="mt-2 text-xs leading-[1.5] text-muted">
          Protection that never sleeps. Designed to feel calm before it ever
          needs to be urgent.
        </p>
      </Card>

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="mt-5 w-full rounded-[15px] border border-danger/40 py-3.5 font-bold text-danger"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}