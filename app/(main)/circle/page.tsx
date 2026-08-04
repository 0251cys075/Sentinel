"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { TopBar } from "@/components/shell";
import { Card, MiniAvatar, initialsOf } from "@/components/primitives";
import type { TrustedContact } from "@/lib/types";

const PRESENCE = ["Safe · Online", "In transit", "Needs check"];
const PRESENCE_CLASS = ["text-primary", "text-accent", "text-muted"];
const PRESENCE_AT = ["Now", "6m", "28m"];

/**
 * Safety Circle — presence is a demo stand-in; a real build would derive
 * it from the circle's active trips / last-seen signals.
 */
export default function CirclePage() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);

  useEffect(() => {
    getSupabaseBrowser()
      .from("trusted_contacts")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => setContacts(data ?? []));
  }, []);

  return (
    <div>
      <TopBar eyebrow="Always connected" title="Safety Circle" backTo="/" />

      <Card>
        <div className="flex items-center py-1">
          {contacts.map((c) => (
            <MiniAvatar key={c.id} initials={initialsOf(c.name)} />
          ))}
          <div className="ml-4">
            <b>{contacts.length} {contacts.length === 1 ? "person" : "people"}</b>
            <br />
            <small className="text-muted">your trusted circle</small>
          </div>
        </div>

        {contacts.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line py-[13px] last:border-0">
            <MiniAvatar initials={initialsOf(c.name)} />
            <div className="flex-1">
              <b>{c.name}</b>
              <br />
              <small className={PRESENCE_CLASS[i % 3]}>● {PRESENCE[i % 3]}</small>
            </div>
            <span className="text-muted">{PRESENCE_AT[i % 3]}</span>
          </div>
        ))}
      </Card>

      <Card className="mt-3">
        <b>Circle rule</b>
        <p className="mt-1 text-xs leading-[1.5] text-muted">
          Primary contacts receive journey updates only when Sentinel detects
          a meaningful change.
        </p>
      </Card>
    </div>
  );
}