"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { TopBar } from "@/components/shell";
import { Card, DemoBadge, Tag } from "@/components/primitives";
import type { Alert, Trip } from "@/lib/types";

type FeedItem = Trip & { alertTypes: string[] };

const ALERT_LABEL: Record<string, string> = {
  nudge: "Check-in",
  alarm: "Loud alarm",
  contact_notify: "Contacts notified",
  sos: "SOS",
};

/**
 * Police / authority dashboard — UI ONLY.
 * Production would require a real police partnership, a signed data-share
 * agreement and service-role access scoped by jurisdiction. This demo shows
 * journeys visible to the signed-in user as stand-in data.
 */
export default function PolicePage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const load = async () => {
      const [{ data: trips }, { data: alerts }] = await Promise.all([
        supabase
          .from("trips")
          .select("*")
          .in("status", ["active", "escalated"])
          .order("started_at", { ascending: false })
          .limit(20),
        supabase.from("alerts").select("trip_id, type, status"),
      ]);
      const byTrip = new Map<string, string[]>();
      for (const a of (alerts ?? []) as Alert[]) {
        if (!a.trip_id) continue;
        const list = byTrip.get(a.trip_id) ?? [];
        list.push(a.type);
        byTrip.set(a.trip_id, list);
      }
      setFeed(
        (trips ?? []).map((t) => ({
          ...t,
          alertTypes: byTrip.get(t.id) ?? [],
        }))
      );
      setLoading(false);
    };

    load();
    const channel = supabase
      .channel("police-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        load
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <TopBar eyebrow="Authority view" title="Emergency Dashboard" backTo="/" />

      <Card className="mb-3 flex items-center gap-3">
        <DemoBadge text="Simulated — requires real police partnership" />
        <p className="text-xs leading-[1.5] text-muted">
          Live journeys with raised alerts appear here. Production wiring would
          stream from Supabase Realtime into a police operations console under
          a formal agreement.
        </p>
      </Card>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading feed…</p>
      ) : feed.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-muted">
            No active journeys in the feed.
          </p>
        </Card>
      ) : (
        feed.map((t) => (
          <Card key={t.id} className="mb-3">
            <div className="flex items-center justify-between">
              <div>
                <b>{t.destination_text}</b>
                <br />
                <small className="text-muted">
                  {t.transit_mode} · started{" "}
                  {new Date(t.started_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
              <Tag className={t.status === "escalated" ? "!bg-danger/10 !text-danger" : undefined}>
                {t.status === "escalated" ? "ESCALATED" : "ACTIVE"}
              </Tag>
            </div>
            {t.alertTypes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {t.alertTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-[20px] bg-[#ffe6e1] px-2.5 py-1 text-[11px] font-bold text-[#b84434]"
                  >
                    {ALERT_LABEL[type] ?? type}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}