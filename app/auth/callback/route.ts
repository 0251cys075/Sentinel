import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

/**
 * Auth callback — the landing spot for magic-link emails (signInWithOtp),
 * Google OAuth (signInWithOAuth), and password-recovery links when they use
 * the PKCE code flow.
 *
 * Supabase redirects here with ?code= (PKCE) — we exchange it for a session,
 * persist the cookies, and send the user home. Any token in the URL hash
 * (implicit flow) is left alone; the browser client picks it up itself.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  let response = NextResponse.redirect(`${origin}${next}`);

  if (code) {
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Push new cookie values onto both the request and response.
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = NextResponse.redirect(`${origin}${next}`);
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }

  return response;
}
