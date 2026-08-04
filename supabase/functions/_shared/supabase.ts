import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Service-role Supabase client for Edge Functions. Bypasses RLS — only
 * ever used in trusted server contexts (cron, database webhooks).
 */
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export function publicBaseUrl(): string {
  // The URL the app is reachable at, used to build share links in pushes.
  return (
    Deno.env.get("PUBLIC_APP_URL") ??
    Deno.env.get("SUPABASE_URL")?.replace(/\.supabase\.co.*$/, "") ??
    "http://localhost:3000"
  );
}
