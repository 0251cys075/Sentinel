import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { BrandMark, ThemeToggle } from "@/components/shell";
import { Card } from "@/components/primitives";

function formatTransitMode(mode: string): string {
  const labels: Record<string, string> = {
    walking: "Walking",
    driving: "Driving",
    transit: "Public transit",
  };
  return labels[mode] ?? mode;
}

function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDay.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const metadata = { title: "Home — Sentinel" };

export default async function HomePage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profileRes, tripsRes, contactsRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle(),
    supabase
      .from("trips")
      .select("*")
      .eq("user_id", user!.id)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("trusted_contacts")
      .select("tier, verified")
      .eq("user_id", user!.id),
  ]);

  const profile = profileRes.data;
  const lastTrip = tripsRes.data?.[0] ?? null;
  const contacts = contactsRes.data ?? [];
  const primaryCount = contacts.filter((c) => c.tier === "primary").length;

  const firstName =
    profile?.full_name?.split(" ")[0] || user!.email?.split("@")[0] || "there";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <BrandMark />
        <ThemeToggle />
      </div>

      <div className="pt-[34px]">
        <div className="eyebrow">Protection that never sleeps</div>
        <h1 className="font-display mt-2 text-[34px] leading-[1.08] tracking-[-0.03em]">
          Safe travels, {firstName}.
        </h1>
        <p className="mt-4 leading-[1.65] text-muted">
          Sentinel watches over your journey in the background, so you can
          focus on getting where you&apos;re going.
        </p>

        <Link
          href="/journey/start"
          className="mt-6 block w-full rounded-[15px] bg-primary px-[18px] py-4 text-center font-bold text-white shadow-[0_10px_24px_rgba(15,110,86,0.18)]"
        >
          Start Walk With Me →
        </Link>

        <div className="mt-[18px] grid grid-cols-4 gap-[9px]">
          <Link
            href="/journey/call"
            className="rounded-[15px] border border-line bg-card p-3 text-center text-[11px] shadow-card"
          >
            <span className="mb-[7px] block text-[20px]">☎</span>Fake Call
          </Link>
          <Link
            href="/sos"
            className="rounded-[15px] border border-line bg-card p-3 text-center text-[11px] shadow-card"
          >
            <span className="mb-[7px] block text-[20px]">◉</span>SOS
          </Link>
          <Link
            href="/circle"
            className="rounded-[15px] border border-line bg-card p-3 text-center text-[11px] shadow-card"
          >
            <span className="mb-[7px] block text-[20px]">◌</span>Circle
          </Link>
          <Link
            href="/route"
            className="rounded-[15px] border border-line bg-card p-3 text-center text-[11px] shadow-card"
          >
            <span className="mb-[7px] block text-[20px]">⌖</span>Safe Route
          </Link>
        </div>

        {lastTrip ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="dot" />
              <b>Sentinel standing by</b>
            </div>
            <span className="rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary">
              Ready
            </span>
          </div>
          <div className="mt-4 flex justify-between">
            <div>
              <small className="text-muted">Last trip</small>
              <br />
              <b>{lastTrip.destination_text}</b>
              <br />
              <small className="text-muted">
                {formatTransitMode(lastTrip.transit_mode)}
              </small>
            </div>
            <div className="text-right">
              <small className="text-muted">
                {formatStartedAt(lastTrip.started_at)}
              </small>
              <br />
              <b>{lastTrip.eta_minutes} min</b>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="dot" />
              <b>Sentinel standing by</b>
            </div>
            <span className="rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary">
              Ready
            </span>
          </div>
          <div className="mt-4">
            <p className="leading-[1.5]">
              No trips yet — start your first Walk With Me journey so Sentinel
              can watch over you.
            </p>
            <Link
              href="/journey/start"
              className="mt-4 inline-block rounded-[10px] bg-primary px-4 py-2.5 text-[13px] font-bold text-white"
            >
              Start a journey →
            </Link>
          </div>
        </Card>
      )}

        <Card className="mt-3">
          <div className="eyebrow">Safety insight</div>
          <p className="mt-2 leading-[1.5]">
            Your usual route is currently clear. A brighter, busier route is
            available 3 min away.
          </p>
        </Card>

        <p className="mt-6 text-center text-xs text-muted">
          {contacts.length} trusted contacts · {primaryCount} primary
        </p>
      </div>
    </div>
  );
}
