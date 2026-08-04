"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * After sign-in / sign-up, link any trusted-contact rows that carry the
 * user's phone number to this account, so the escalation edge function can
 * push alerts to them via their FCM token.
 */
export async function linkContactAccountToUser(): Promise<void> {
  const supabase = getSupabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.phone) return; // email sign-ups have no phone to match on

  await supabase.rpc("link_my_contact_account", { p_phone: user.phone });
}