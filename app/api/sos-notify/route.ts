import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendResendEmail, sendWhatsAppMessage } from "@/lib/notify";
import type { TrustedContact } from "@/lib/types";

export const runtime = "nodejs";

const sosMessage = (fullName: string) =>
  `🚨 SENTINEL ALERT: ${fullName} has triggered an emergency SOS. Please contact them immediately and check on their safety.`;

export async function POST(request: Request) {
  let body: { userId?: string; alertId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { userId, alertId } = body;
  if (!userId || !alertId) {
    return NextResponse.json(
      { ok: false, error: "userId and alertId are required" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();

  // Only the account owner may trigger notifications for their contacts.
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (caller.id !== userId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const [profileRes, contactsRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase
      .from("trusted_contacts")
      .select("*")
      .eq("user_id", userId)
      .eq("tier", "primary"),
  ]);

  if (contactsRes.error) {
    console.error("[sos-notify] contacts fetch failed:", contactsRes.error);
    return NextResponse.json({ ok: false, error: contactsRes.error.message }, { status: 500 });
  }

  const fullName = profileRes.data?.full_name ?? "a Sentinel user";
  const alertText = sosMessage(fullName);
  const contacts = (contactsRes.data ?? []) as TrustedContact[];
  const results: unknown[] = [];

  for (const contact of contacts) {
    // Only verified contacts actually receive SOS alerts.
    if (!contact.verified) {
      console.log(`[sos-notify] skipping unverified contact "${contact.name}" (id=${contact.id})`);
      results.push({ contact: contact.name, skipped: true, reason: "unverified" });
      continue;
    }

    if (contact.phone) {
      const r = await sendWhatsAppMessage(contact.phone, alertText);
      console.log(`[sos-notify] ${contact.name}: ${r.detail}`);
      results.push({ contact: contact.name, channel: "whatsapp", ...r });
    } else if (contact.email) {
      const r = await sendResendEmail(contact.email, "🚨 SENTINEL ALERT — SOS", alertText);
      console.log(`[sos-notify] ${contact.name}: ${r.detail}`);
      results.push({ contact: contact.name, channel: "email", ...r });
    } else {
      console.log(`[sos-notify] skipping contact "${contact.name}": no phone or email`);
      results.push({ contact: contact.name, skipped: true, reason: "no phone or email" });
    }
  }

  return NextResponse.json({ ok: true, alertId, results });
}