import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabase } from "@/lib/supabase/server";
import type { TrustedContact } from "@/lib/types";

export const runtime = "nodejs";

const RESEND_FROM = "sentinel@resend.dev";

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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY is not configured" },
      { status: 500 }
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
      .eq("tier", "primary")
      .eq("verified", true),
  ]);

  if (contactsRes.error) {
    console.error("[sos-notify] contacts fetch failed:", contactsRes.error);
    return NextResponse.json({ ok: false, error: contactsRes.error.message }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const fullName = profileRes.data?.full_name ?? "a Sentinel user";
  const contacts = (contactsRes.data ?? []) as TrustedContact[];
  const results: unknown[] = [];

  // 1. Emergency emails to every verified primary contact with an email.
  for (const contact of contacts) {
    if (!contact.email) {
      console.log(`[sos-notify] skipping contact "${contact.name}": no email address`);
      results.push({ contact: contact.name, skipped: true, reason: "no email address" });
      continue;
    }

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to: [contact.email],
      subject: `🚨 SENTINEL ALERT — ${fullName} needs help`,
      html:
        `<h2>Emergency Alert from Sentinel</h2>` +
        `<p><strong>${fullName}</strong> has triggered an emergency SOS alert.</p>` +
        `<p>Please contact them immediately and check on their safety.</p>` +
        `<p>This alert was sent automatically by the Sentinel safety app.</p>`,
    });

    if (error) {
      console.error(`[sos-notify] email to ${contact.name} failed:`, error);
      results.push({ contact: contact.name, ok: false, detail: error.message });
    } else {
      console.log(`[sos-notify] emailed ${contact.name} <${contact.email}> (id=${data?.id})`);
      results.push({ contact: contact.name, ok: true, id: data?.id });
    }
  }

  // 2. Confirmation email to the user who triggered the SOS.
  if (caller.email) {
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to: [caller.email],
      subject: "Your SOS alert was sent",
      text: "Your emergency contacts have been notified. Help is on the way.",
    });

    if (error) {
      console.error("[sos-notify] confirmation email failed:", error);
      results.push({ contact: "user", ok: false, detail: error.message });
    } else {
      console.log(`[sos-notify] confirmation emailed ${caller.email} (id=${data?.id})`);
      results.push({ contact: "user", ok: true, id: data?.id });
    }
  }

  return NextResponse.json({ ok: true, alertId, results });
}