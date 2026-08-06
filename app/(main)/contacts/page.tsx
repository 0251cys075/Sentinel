"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { ThemeToggle } from "@/components/shell";
import {
  Card,
  Chip,
  Field,
  MiniAvatar,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  TextInput,
  initialsOf,
} from "@/components/primitives";
import type { TrustedContact } from "@/lib/types";

const RELATIONSHIPS = ["Family", "Friend", "Colleague", "Other"];

export default function ContactsPage() {
  const router = useRouter();
  const toast = useToast();

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("Family");
  const [tier, setTier] = useState<"primary" | "secondary">("primary");
  const [saving, setSaving] = useState(false);

  const [verifyTarget, setVerifyTarget] = useState<TrustedContact | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const supabase = getSupabaseBrowser();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("trusted_contacts")
      .select("*")
      .order("created_at", { ascending: true });
    setContacts(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const primary = contacts.filter((c) => c.tier === "primary");
  const secondary = contacts.filter((c) => c.tier === "secondary");

  const openSheet = () => {
    setName("");
    setPhone("");
    setEmail("");
    setRelationship("Family");
    setTier("primary");
    setSheetOpen(true);
  };

  const save = async () => {
    const n = name.trim();
    const p = phone.trim();
    const e = email.trim();
    if (!n) return toast("Add a contact name");
    if (!p || p.replace(/\D/g, "").length < 8) return toast("Add a valid phone number");

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: inserted, error } = await supabase
        .from("trusted_contacts")
        .insert({
          user_id: user.id,
          name: n,
          phone: p,
          email: e || null,
          relationship,
          tier,
          verified: false,
        })
        .select("id")
        .single();
      if (error) throw error;

      setSheetOpen(false);
      toast(`${n} added — verification code sent`);

      // Send the 6-digit verification code in the background.
      void fetch("/api/contact-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: inserted.id }),
      }).catch((err) => console.error("[contacts] verification send failed:", err));

      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add contact");
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    if (!verifyTarget) return;
    const trimmed = code.trim();
    if (trimmed.length !== 6) return toast("Enter the 6-digit verification code");

    setVerifying(true);
    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: verifyTarget.id, code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("[contacts] verify-code failed:", data);
        throw new Error(data.error ?? "Could not verify contact");
      }
      setVerifyTarget(null);
      setCode("");
      toast(`${verifyTarget.name} verified`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not verify contact");
    } finally {
      setVerifying(false);
    }
  };

  const ContactRow = ({ c }: { c: TrustedContact }) => (
    <div className="flex items-center gap-3 border-b border-line py-[13px] last:border-0">
      <MiniAvatar initials={initialsOf(c.name)} />
      <div className="flex-1">
        <b>{c.name}</b>
        <br />
        <span className={c.verified ? "text-[10px] font-bold text-primary" : "text-[10px] font-bold text-accent"}>
          {c.verified ? "✓ Verified" : "Pending"} · {c.tier === "primary" ? "Primary" : "Secondary"}
          {c.relationship !== "Other" && ` · ${c.relationship}`}
        </span>
      </div>
      {c.verified ? (
        <span className="text-muted">⋯</span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCode("");
            setVerifyTarget(c);
          }}
          className="rounded-[20px] bg-primary2 px-3 py-1.5 text-[11px] font-bold text-primary"
        >
          Verify
        </button>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="eyebrow">Your people</div>
          <h2 className="font-display text-xl">Trusted Contacts</h2>
        </div>
        <ThemeToggle />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <b>Primary circle</b>
            <br />
            <small className="text-muted">Notified first</small>
          </div>
          <span className="rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary">
            {primary.length} {primary.length === 1 ? "person" : "people"}
          </span>
        </div>
        <div className="mt-2">
          {primary.map((c) => (
            <ContactRow key={c.id} c={c} />
          ))}
          {secondary.map((c) => (
            <ContactRow key={c.id} c={c} />
          ))}
          {contacts.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              {loading ? "Loading…" : "No contacts yet — add your people."}
            </p>
          )}
        </div>
      </Card>

      <SecondaryButton className="mt-3.5 w-full" onClick={() => router.push("/circle")}>
        ◌ View Safety Circle
      </SecondaryButton>
      <PrimaryButton className="mt-2.5" onClick={openSheet}>
        + Add Trusted Contact
      </PrimaryButton>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div className="illus">👤</div>
        <div className="eyebrow">Trusted circle</div>
        <h2 className="font-display mt-1.5 text-xl">Add a trusted contact</h2>

        <Field label="FULL NAME">
          <TextInput value={name} onChange={setName} placeholder="e.g. Maya Iyer" autoFocus />
        </Field>
        <Field label="PHONE NUMBER">
          <TextInput value={phone} onChange={setPhone} placeholder="+91 98765 43210" type="tel" />
        </Field>
        <Field label="EMAIL (OPTIONAL — FALLBACK ALERTS)">
          <TextInput value={email} onChange={setEmail} placeholder="maya@example.com" type="email" />
        </Field>
        <Field label="RELATIONSHIP">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {RELATIONSHIPS.map((r) => (
              <Chip key={r} selected={relationship === r} onClick={() => setRelationship(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="PRIMARY OR SECONDARY">
          <div className="grid grid-cols-2 gap-[7px]">
            {(["primary", "secondary"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`rounded-[12px] border px-3 py-[11px] text-sm capitalize ${
                  tier === t ? "border-primary bg-primary2 font-bold text-primary" : "border-line bg-card"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add to Trusted Contacts"}
        </PrimaryButton>
        <SecondaryButton className="mt-2.5 w-full" onClick={() => setSheetOpen(false)}>
          Cancel
        </SecondaryButton>
      </Sheet>

      <Sheet open={verifyTarget !== null} onClose={() => setVerifyTarget(null)}>
        <div className="illus">✓</div>
        <div className="eyebrow">Trusted circle</div>
        <h2 className="font-display mt-1.5 text-xl">Verify {verifyTarget?.name}</h2>
        <p className="mb-4 mt-2 text-sm leading-[1.6] text-muted">
          Enter the 6-digit code we sent to {verifyTarget?.phone || verifyTarget?.email}.
          Verified contacts receive real SOS alerts.
        </p>
        <Field label="VERIFICATION CODE">
          <TextInput value={code} onChange={setCode} placeholder="123456" type="tel" />
        </Field>
        <PrimaryButton onClick={verify} disabled={verifying}>
          {verifying ? "Verifying…" : "Verify Contact"}
        </PrimaryButton>
        <SecondaryButton className="mt-2.5 w-full" onClick={() => setVerifyTarget(null)}>
          Cancel
        </SecondaryButton>
      </Sheet>
    </div>
  );
}
