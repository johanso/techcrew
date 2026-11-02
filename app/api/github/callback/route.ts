import { NextResponse, type NextRequest } from "next/server";

import { isSafeRedirectPath } from "@/lib/auth";
import { getCurrentUser } from "@/lib/current-user";
import {
  GITHUB_OAUTH_COOKIE,
  exchangeCodeForToken,
  getGithubUser,
  githubCallbackUrl,
  saveGithubConnection,
} from "@/lib/github";

type PendingAuth = { state: string; verifier: string; next: string };

function readPending(raw: string | undefined): PendingAuth | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return typeof value?.state === "string" && typeof value?.verifier === "string" ? value : null;
  } catch {
    return null;
  }
}

/** GitHub OAuth callback: verifies state, stores the encrypted token, returns to the form. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pending = readPending(request.cookies.get(GITHUB_OAUTH_COOKIE)?.value);
  const next = pending && isSafeRedirectPath(pending.next) ? pending.next : "/workspaces/new";

  const finish = (status: "connected" | "denied" | "error") => {
    const url = new URL(next, request.url);
    url.searchParams.set("github", status);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: GITHUB_OAUTH_COOKIE, path: "/api/github" });
    return response;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, request.url));

  if (params.get("error") === "access_denied") return finish("denied");
  const code = params.get("code");
  if (!pending || !code || params.get("state") !== pending.state) return finish("error");

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    const { accessToken, scope } = await exchangeCodeForToken({
      code,
      verifier: pending.verifier,
      redirectUri: githubCallbackUrl(origin),
    });
    const account = await getGithubUser(accessToken);
    await saveGithubConnection(user.id, {
      githubUserId: account.id,
      login: account.login,
      avatarUrl: account.avatar_url,
      accessToken,
      scope,
    });
  } catch (error) {
    console.error("[github] connect failed", error);
    return finish("error");
  }

  return finish("connected");
}
