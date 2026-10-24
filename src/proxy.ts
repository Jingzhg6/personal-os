import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

/**
 * Optimistic auth gate: only checks that a session cookie exists, so signed-out
 * visitors are redirected before rendering. The real check (session validity)
 * happens in the (app) layout and in every tRPC procedure.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || getSessionCookie(request)) {
    return NextResponse.next();
  }

  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip API routes, Next.js internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
