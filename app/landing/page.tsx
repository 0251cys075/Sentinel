import Link from "next/link";
import { BrandMark, ThemeToggle } from "@/components/shell";

export const metadata = { title: "Sentinel — Protection that never sleeps" };

export default function LandingPage() {
  return (
    <div className="app-shell">
      <div className="screen">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <ThemeToggle />
        </div>

        <div className="pt-[34px]">
          <div className="eyebrow">Protection that never sleeps</div>
          <h1 className="font-display mt-2 text-[34px] leading-[1.08] tracking-[-0.03em]">
            Your quiet layer of safety.
          </h1>
          <p className="mt-4 leading-[1.65] text-muted">
            Sentinel watches over your journey in the background, so you can
            focus on getting where you&apos;re going.
          </p>

          <Link
            href="/login"
            className="mt-6 block w-full rounded-[15px] bg-primary px-[18px] py-4 text-center font-bold text-white shadow-[0_10px_24px_rgba(15,110,86,0.18)]"
          >
            Start Walk With Me →
          </Link>

          <div className="mt-[18px] grid grid-cols-4 gap-[9px]">
            {[
              { icon: "☎", label: "Fake Call" },
              { icon: "◉", label: "SOS" },
              { icon: "◌", label: "Circle" },
              { icon: "⌖", label: "Safe Route" },
            ].map((q) => (
              <Link
                key={q.label}
                href="/login"
                className="rounded-[15px] border border-line bg-card p-3 text-center text-[11px] shadow-card"
              >
                <span className="mb-[7px] block text-[20px]">{q.icon}</span>
                {q.label}
              </Link>
            ))}
          </div>

          <div className="mt-6 rounded-card border border-line bg-card p-[18px] shadow-card">
            <div className="flex items-center justify-between">
              <div>
                <span className="dot" />
                <b>Sentinel standing by</b>
              </div>
              <span className="rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary">
                Ready
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Sign in to start a journey, add trusted contacts and arm your
              safety circle.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
