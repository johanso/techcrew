import { NextResponse, type NextRequest } from "next/server";

import { isAllowedHost } from "@/lib/host-guard";
import { SESSION_COOKIE } from "@/lib/session-config";

/**
 * Two optimistic checks before a request reaches a page, an action or a route:
 * 1. DNS-rebinding guard: only requests addressed to this computer (or NEXT_PUBLIC_APP_URL's host) pass. Inngest and
 *    the agents' MCP calls reach the app at 127.0.0.1, so they pass too (they still need their own bearer).
 * 2. Visitors without a session cookie are bounced from /dashboard and /workspaces. The cookie's signature is
 *    verified by getCurrentUser() (lib/current-user.ts).
 */
export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"), process.env.NEXT_PUBLIC_APP_URL)) {
    return new NextResponse("Unknown host: open TechTeam at http://localhost:3000.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { pathname, search } = request.nextUrl;
  const protectedPath = /^\/(dashboard|workspaces)(\/|$)/.test(pathname);
  if (!protectedPath || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", pathname + search);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except Next's static files and the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
