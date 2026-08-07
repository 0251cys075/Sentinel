import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

export function createClient() {
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        // Persist the session beyond the current tab so reloads and browser
        // restarts keep the user signed in (managed as cookies by
        // @supabase/ssr's storage bridge).
        persistSession: true,
        // Keep the access token fresh in the background.
        autoRefreshToken: true,
        // On the OAuth callback, look for tokens/code in the URL (both the
        // `#access_token=...` hash from implicit flow and `?code=` from the
        // PKCE flow) and finalize sign-in automatically.
        detectSessionInUrl: true,
      },
    }
  );
}

let browserClient: ReturnType<typeof createClient> | null = null;

/** Singleton browser client — safe to call from any client component. */
export function getSupabaseBrowser() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}
