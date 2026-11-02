import { NextResponse, type NextRequest } from "next/server";

import { isSafeRedirectPath } from "@/lib/auth";
import { getCurrentUser } from "@/lib/current-user";
import {
  GITHUB_OAUTH_COOKIE,
  createOAuthChallenge,
  githubAuthorizeUrl,
  githubCallbackUrl,
  isGithubConfigured,
} from "@/lib/github";

/** Starts linking a GitHub account. GitHub returns to /api/github/callback. */
export async function GET(request: NextRequest) {
  const nextParam = request.nextUrl.searchParams.get("next");
  const next = isSafeRedirectPath(nextParam) ? nextParam : "/workspaces/new";

  if (!(await getCurrentUser())) {
    return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, request.url));
  }
  if (!isGithubConfigured()) {
    const back = new URL(next, request.url);
    back.searchParams.set("github", "not-configured");
    return NextResponse.redirect(back);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const { state, verifier, challenge } = createOAuthChallenge();
  const response = NextResponse.redirect(
    githubAuthorizeUrl({ state, challenge, redirectUri: githubCallbackUrl(origin) })
  );
  response.cookies.set(GITHUB_OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github",
    maxAge: 60 * 10,
  });
  return response;
}
