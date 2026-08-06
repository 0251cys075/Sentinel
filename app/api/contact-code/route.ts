import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateVerificationCode, sendResendEmail, sendWhatsAppMessage } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * Sends a 6-digit verification code to a freshly added trusted contact
 * (WhatsApp, falling back to email when the contact has no phone).
 * Stores the code in `pending_verification_code` until /api/verify-code
 * confirms it. Unconfigured channels no-op gracefully.
 */
export async function POST(request: Request) {
  let body: { contactId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { contactId } = body;
  if (!contactId) {
    return NextResponse.json({ ok: false, error: "contactId is required" }, { status: 400 });
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

  const code = generateVerificationCode();
  const { error: updateError } = await supabase
    .from("trusted_contacts")
    .update({ pending_verification_code: code })
    .eq("id", contactId);
  if (updateError) {
    console.error("[contact-code] storing code failed:", updateError);
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const verificationText =
    `Your Sentinel verification code is ${code}. ` +
    `Enter it in the app to confirm you're a trusted contact.`;

  const result = contact.phone
    ? await sendWhatsAppMessage(contact.phone, verificationText)
    : contact.email
      ? await sendResendEmail(contact.email, "Your Sentinel verification code", verificationText)
      : { ok: false, detail: "contact has no phone or email" };

  console.log(`[contact-code] ${contact.name}: ${result.detail}`);

  return NextResponse.json({ ok: true, sent: result.ok, detail: result.detail });
}