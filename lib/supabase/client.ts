import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

export function createClient() {
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
  );
}

let browserClient: ReturnType<typeof createClient> | null = null;

/** Singleton browser client — safe to call from any client component. */
export function getSupabaseBrowser() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}
