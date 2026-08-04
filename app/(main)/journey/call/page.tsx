"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { DemoBadge } from "@/components/primitives";

/** Fake call screen — purely a UI deterrent, no real call is placed. */
export default function FakeCallPage() {
  const router = useRouter();
  const toast = useToast();

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };

  return (
    <div className="call">
      <div className="flex w-full items-center justify-between">
        <div />
        <div className="eyebrow text-center">Incoming call</div>
        <DemoBadge text="Fake call — no real line" />
      </div>

      <div className="avatar">AR</div>
      <h1 className="font-display text-[30px]">Aarav Mehta</h1>
      <div className="mt-2 text-muted">mobile</div>

      <div className="mt-auto flex w-full justify-around pb-[22px]">
        <div className="text-center">
          <button type="button" onClick={() => toast("Call muted (demo)")} className="callaction">
            🔇
          </button>
          <small className="text-muted">Mute</small>
        </div>
        <div className="text-center">
          <button type="button" onClick={back} className="callaction end">
            ☎
          </button>
          <small className="text-muted">Decline</small>
        </div>
        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              toast("Call connected (demo)");
              back();
            }}
            className="callaction"
          >
            ☎
          </button>
          <small className="text-muted">Accept</small>
        </div>
      </div>
    </div>
  );
}