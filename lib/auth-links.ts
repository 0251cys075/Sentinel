"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

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

/**
 * Frictionless onboarding helper: persist the user's display name from
 * auth `user_metadata` (Google exposes `full_name`/`name`) into their
 * `profiles` row so the dashboard greets them by name on first load.
 * Best-effort — RLS failures are swallowed so sign-in never blocks.
 */
export async function syncProfileName(user: User): Promise<void> {
  const metaName =
    user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (!metaName) return;

  const supabase = getSupabaseBrowser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.full_name) return; // already named

  try {
    if (profile) {
      await supabase
        .from("profiles")
        .update({ full_name: metaName })
        .eq("id", user.id);
    } else {
      await supabase
        .from("profiles")
        .insert({ id: user.id, full_name: metaName });
    }
  } catch {
    // RLS or schema gap — leave the greeting fallback to do the job.
    console.error("[auth] profile name sync failed — skipping gracefully");
  }
}