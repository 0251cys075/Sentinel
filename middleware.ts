import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** Paths that are public: not behind auth, never redirect when authed. */
const PUBLIC_PATHS = ["/login", "/landing", "/track"];

export async function middleware(request: NextRequest) {
  const { user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Signed-out users may only see the public pages.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/landing";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users shouldn't see the marketing / auth pages.
  if (user && (isPublic && (pathname === "/login" || pathname === "/landing"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|firebase-messaging-sw\\.js|.*\\.(?:svg|png|jpg|jpeg|webp|gif)$).*)",
  ],
};