"use client";

import { useState } from "react";
import { TopBar } from "@/components/shell";
import { Card, Tag } from "@/components/primitives";

type RouteChoice = "safest" | "fastest";

const ROUTE_DATA = {
  safest: { badge: "Safest · 21 min · Risk low", minutes: "21 min", risk: "low" },
  fastest: { badge: "Fastest · 17 min · Risk moderate", minutes: "17 min", risk: "moderate" },
} as const;

/**
 * Safe Route Map. The heatmap is a styled mock overlay (real routing APIs
 * like Google Routes / Mapbox would replace it in production).
 */
export default function RoutePage() {
  const [route, setRoute] = useState<RouteChoice>("safest");
  const data = ROUTE_DATA[route];
  const fast = route === "fastest";

  return (
    <div>
      <TopBar eyebrow="AI route intelligence" title="Safe Route" backTo="/" />

      <div className="map">
        <div className="heatmap" />
        <div
          className="road"
          style={
            fast
              ? { background: "var(--accent)", top: "38%", transform: "rotate(-12deg)" }
              : undefined
          }
        />
        <div className="pin a" />
        <div className="pin b" />
        <div className="mapbadge">{data.badge}</div>
      </div>

      <div className="mt-3 flex rounded-[14px] border border-line bg-card p-1">
        <button
          type="button"
          onClick={() => setRoute("safest")}
          className={`flex-1 rounded-[10px] py-[11px] text-sm ${
            route === "safest" ? "bg-primary2 font-bold text-primary" : ""
          }`}
        >
          Safest · 21 min
        </button>
        <button
          type="button"
          onClick={() => setRoute("fastest")}
          className={`flex-1 rounded-[10px] py-[11px] text-sm ${
            route === "fastest" ? "bg-primary2 font-bold text-primary" : ""
          }`}
        >
          Fastest · 17 min
        </button>
      </div>

      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <b>Route confidence</b>
          <Tag>{data.risk === "low" ? "92%" : "78%"}</Tag>
        </div>
        <p className="mt-1 text-xs leading-[1.5] text-muted">
          AI favors brighter roads, open businesses and recent safe-travel
          signals.
        </p>
        <div className="flex gap-2">
          <Tag>Green · Low</Tag>
          <Tag className="bg-[#fff1df] !text-accent">Amber · Moderate</Tag>
          <Tag className="bg-[#ffe6e1] !text-[#b84434]">Red · Avoid</Tag>
        </div>
      </Card>
    </div>
  );
}