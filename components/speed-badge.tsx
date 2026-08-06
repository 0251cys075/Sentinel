"use client";

/** Shared ⚡ speed badge (live journey + guest tracking pages). */

import { classifySpeed } from "@/lib/telemetry";

export function SpeedBadge({
  kmh,
  className = "",
}: {
  kmh: number | null;
  className?: string;
}) {
  const badge = classifySpeed(kmh);
  if (!badge) return null;
  return (
    <div
      className={className}
      style={{
        background: badge.bg,
        color: badge.color,
        border: `1px solid ${badge.color}33`,
        padding: "7px 10px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        boxShadow: "var(--shadow)",
      }}
    >
      {badge.txt}
    </div>
  );
}
