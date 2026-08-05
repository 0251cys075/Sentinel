import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

/** Paths that are public — never redirect signed-out users away from these. */
const PUBLIC_PATHS = ["/login", "/landing", "/track", "/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Build a mutable response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  try {
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
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // Refreshes the session — must be called before any redirect logic.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );

    // Signed-out users may only see public pages.
    if (!user && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/landing";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Signed-in users are sent away from auth/marketing pages.
    if (user && isPublic && (pathname === "/login" || pathname === "/landing")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  } catch (err) {
    // If Supabase is unreachable we let the request through rather than
    // crashing the Edge Runtime with a 500.
    console.error("[middleware] Supabase session refresh failed:", err);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT static assets, images, and the SW file.
     * This keeps the middleware out of the critical path for those resources.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|firebase-messaging-sw\\.js|.*\\.(?:svg|png|jpg|jpeg|webp|gif)$).*)",
  ],
};