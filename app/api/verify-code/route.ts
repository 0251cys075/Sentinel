import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Verifies a trusted contact against the 6-digit code that was sent to them.
 * On success sets `verified = true` and clears the pending code.
 */
export async function POST(request: Request) {
  let body: { contactId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { contactId, code } = body;
  const trimmedCode = code?.trim() ?? "";
  if (!contactId || !trimmedCode) {
    return NextResponse.json({ ok: false, error: "contactId and code are required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data: contact, error } = await supabase
    .from("trusted_contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (error || !contact || contact.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "contact not found" }, { status: 404 });
  }

  if (!contact.pending_verification_code || contact.pending_verification_code !== trimmedCode) {
    return NextResponse.json({ ok: false, error: "Invalid or expired verification code" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("trusted_contacts")
    .update({ verified: true, pending_verification_code: null })
    .eq("id", contactId);
  if (updateError) {
    console.error("[verify-code] update failed:", updateError);
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, contactId });
}