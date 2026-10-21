import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session-cookie";

/**
 * Fast path only: bounces requests without a session cookie to /login. The real session check
 * (cookie hash in the database) happens in every page, server action and API route.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!login|_next/static|_next/image|icons/|icon|apple-icon|manifest.webmanifest|sw.js|offline.html|favicon.ico|robots.txt).*)",
  ],
};
