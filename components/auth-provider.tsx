"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { syncProfileName } from "@/lib/auth-links";

const AuthContext = createContext<{ user: User | null; loading: boolean }>({
  user: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Boots auth before rendering the UI tree. On mount it fetches the current
 * session (which also parses OAuth callback tokens / PKCE codes from the
 * URL), then keeps `user` in sync with every auth event. The UI stays hidden
 * until the initial session check resolves so a signed-in user never flashes
 * the signed-out screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Clear error query params if present in URL so a broken OAuth callback
    // (e.g. `?error=auth` or a stale Supabase error) can't wedge the user in
    // a redirect loop on reload.
    if (window.location.href.includes("error=")) {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
    }

    const supabase = getSupabaseBrowser();

    // 1. Fetch the current session — handles OAuth callback token parsing.
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        void syncProfileName(session.user);
      }
      setLoading(false);
    };

    initAuth();

    // 2. Listen for auth changes and keep state synced instantly.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setUser(session.user);
          void syncProfileName(session.user);
        } else if (event === "SIGNED_OUT") {
          setUser(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {loading ? null : children}
    </AuthContext.Provider>
  );
}