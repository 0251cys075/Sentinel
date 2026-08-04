/**
 * Tiered escalation timing — the exact rules from the Sentinel spec.
 *
 * Elapsed time is measured from `expected_arrival_at` (ETA + buffer).
 * Each stage fires once, the first time `now >= expected + threshold`.
 */
export const ESCALATION_STAGES = [
  {
    type: "nudge" as const,
    pctOfEta: 0.25,
    floorMinutes: 2,
    ceilingMinutes: 15,
    pushTarget: "user" as const,
  },
  {
    type: "alarm" as const,
    pctOfEta: 0.5,
    floorMinutes: 5,
    ceilingMinutes: 30,
    pushTarget: "user" as const,
  },
  {
    type: "contact_notify" as const,
    pctOfEta: 0.75,
    floorMinutes: 8,
    ceilingMinutes: 45,
    pushTarget: "contacts" as const,
  },
] as const;

/** Threshold in minutes past `expected_arrival_at` for a stage. */
export function stageThresholdMinutes(
  stage: (typeof ESCALATION_STAGES)[number],
  etaMinutes: number
): number {
  const raw = stage.pctOfEta * etaMinutes;
  return Math.min(Math.max(raw, stage.floorMinutes), stage.ceilingMinutes);
}

export function minutesOverdue(expectedArrivalAt: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(expectedArrivalAt).getTime()) / 60000);
}

export interface StageDue {
  stage: (typeof ESCALATION_STAGES)[number];
  minutes: number;
}

/** Which stages are currently due, in trigger order. */
export function dueStages(etaMinutes: number, overdueMinutes: number): StageDue[] {
  return ESCALATION_STAGES.map((stage) => ({
    stage,
    minutes: stageThresholdMinutes(stage, etaMinutes),
  }))
    .filter((s) => overdueMinutes >= s.minutes)
    .map((s) => s.stage)
    .map((stage) => ({ stage, minutes: stageThresholdMinutes(stage, etaMinutes) }));
}
