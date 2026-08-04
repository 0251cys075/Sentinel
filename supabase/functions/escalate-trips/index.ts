import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

/**
 * Tiered escalation stages — identical rules to lib/escalation.ts on the
 * Next.js side. Elapsed time is measured from expected_arrival_at
 * (ETA + buffer). Each stage fires once, the first time the trip is that
 * many minutes overdue.
 */
const STAGES = [
  { type: "nudge", pct: 0.25, floorMin: 2, ceilingMin: 15 },
  { type: "alarm", pct: 0.5, floorMin: 5, ceilingMin: 30 },
  { type: "contact_notify", pct: 0.75, floorMin: 8, ceilingMin: 45 },
] as const;

function thresholdMinutes(
  stage: (typeof STAGES)[number],
  etaMinutes: number
): number {
  return Math.min(Math.max(stage.pct * etaMinutes, stage.floorMin), stage.ceilingMin);
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const supabase = getServiceClient();
    const now = new Date();

    const { data: trips, error: tripsError } = await supabase
      .from("trips")
      .select("id, user_id, eta_minutes, expected_arrival_at")
      .eq("status", "active")
      .lt("expected_arrival_at", now.toISOString());

    if (tripsError) throw tripsError;
    if (!trips || trips.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, alerts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tripIds = trips.map((t) => t.id);
    const { data: existingRows } = await supabase
      .from("alerts")
      .select("trip_id, type")
      .in("trip_id", tripIds)
      .neq("status", "resolved");

    const existing = new Set((existingRows ?? []).map((a) => `${a.trip_id}:${a.type}`));

    let inserted = 0;
    const escalateIds: string[] = [];

    for (const trip of trips) {
      const overdueMin =
        (now.getTime() - new Date(trip.expected_arrival_at).getTime()) / 60000;

      for (const stage of STAGES) {
        if (overdueMin < thresholdMinutes(stage, trip.eta_minutes)) continue;
        const key = `${trip.id}:${stage.type}`;
        if (existing.has(key)) continue; // already fired this stage

        const { error: insertError } = await supabase.from("alerts").insert({
          trip_id: trip.id,
          user_id: trip.user_id,
          type: stage.type,
        });
        if (insertError) {
          console.error(`insert alert ${key} failed:`, insertError.message);
          continue;
        }
        inserted++;
        existing.add(key);
        if (stage.type === "contact_notify") escalateIds.push(trip.id);
      }
    }

    // Contact escalation marks the trip, so the frontend shows the change.
    if (escalateIds.length > 0) {
      const { error: tripError } = await supabase
        .from("trips")
        .update({ status: "escalated" })
        .in("id", escalateIds);
      if (tripError) console.error("escalate trip failed:", tripError.message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: trips.length,
        alertsInserted: inserted,
        tripsEscalated: escalateIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
