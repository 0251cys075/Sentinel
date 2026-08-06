import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/env";

/**
 * Server-only Supabase client with the service-role key. Bypasses RLS so
 * the API can read contact FCM tokens and check alert status even after
 * the caller's request has ended. Never import this from a client bundle.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY isn't set (fresh checkout),
 * so callers can degrade gracefully.
 */
export function createServiceSupabase(): SupabaseClient | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.warn("[supabase/admin] SUPABASE_SERVICE_ROLE_KEY not configured");
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
