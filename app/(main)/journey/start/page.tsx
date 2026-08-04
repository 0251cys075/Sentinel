"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { TopBar } from "@/components/shell";
import {
  Card,
  Chip,
  Field,
  PrimaryButton,
  TextInput,
} from "@/components/primitives";
import type { TrustedContact } from "@/lib/types";

const TRANSIT_MODES = ["🚶 Walk", "🚗 Auto", "🚕 Cab", "🚌 Bus", "🚆 Train"];
const BASE_ETA_MINUTES = 13;

export default function StartJourneyPage() {
  const router = useRouter();
  const toast = useToast();

  const [destination, setDestination] = useState("Home · 24 Green Park");
  const [buffer, setBuffer] = useState(5);
  const [mode, setMode] = useState(0);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase
      .from("trusted_contacts")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) return;
        setContacts(data ?? []);
        setSelected(new Set(data.filter((c) => c.verified).map((c) => c.id)));
      });
  }, []);

  const eta = BASE_ETA_MINUTES + buffer;

  async function startJourney() {
    if (!destination.trim()) {
      toast("Add a destination before starting");
      return;
    }
    if (selected.size === 0) {
      toast("Add at least one trusted contact");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const startedAt = new Date();
      const arrival = new Date(startedAt.getTime() + eta * 60000);

      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          destination_text: destination.trim(),
          destination_lat: null,
          destination_lng: null,
          transit_mode: TRANSIT_MODES[mode].slice(2).trim(),
          eta_minutes: eta,
          buffer_minutes: buffer,
          status: "active",
          started_at: startedAt.toISOString(),
          expected_arrival_at: arrival.toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;
      toast(`Journey started — arrive by ${arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      router.push(`/journey/live?trip=${data.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start journey");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <TopBar eyebrow="New journey" title="Start Journey" backTo="/" />

      <Field label="DESTINATION">
        <TextInput
          value={destination}
          onChange={setDestination}
          placeholder="Where are you going?"
        />
      </Field>

      <Card>
        <div className="flex items-center justify-between">
          <b>Estimated arrival</b>
          <span className="rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary">
            {eta} min
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Buffer <b className="text-text">+{buffer} min</b> · editable
        </p>
        <input
          type="range"
          min={0}
          max={20}
          value={buffer}
          onChange={(e) => setBuffer(+e.target.value)}
          className="w-full"
        />
      </Card>

      <Field label="TRANSIT MODE">
        <div className="grid grid-cols-5 gap-[7px]">
          {TRANSIT_MODES.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(i)}
              className={`rounded-[12px] border px-1 py-[11px] text-[11px] ${
                mode === i
                  ? "border-primary bg-primary2 text-primary"
                  : "border-line bg-card"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>

      <Field label="TRUSTED CONTACTS">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {contacts.map((c) => (
            <Chip
              key={c.id}
              selected={selected.has(c.id)}
              onClick={() => {
                const next = new Set(selected);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                setSelected(next);
              }}
            >
              {c.name.split(" ")[0]} {c.verified ? "✓" : ""}
            </Chip>
          ))}
          <Chip onClick={() => router.push("/contacts")}>+ Add</Chip>
        </div>
      </Field>

      <PrimaryButton className="mt-3" onClick={startJourney} disabled={busy}>
        {busy ? "Starting…" : "Confirm & Start Journey"}
      </PrimaryButton>
    </div>
  );
}
