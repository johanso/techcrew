import { NextResponse, type NextRequest } from "next/server";

import { SOCIAL_NEXT_COOKIE, SOCIAL_PROVIDERS, socialSignInUrl, type SocialProvider } from "@/lib/auth";

/** Starts a GitHub / Google sign-in. The provider returns to /auth/callback#token=… */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/auth/social/[provider]">) {
  const { provider } = await ctx.params;
  if (!SOCIAL_PROVIDERS.includes(provider as SocialProvider)) {
    return NextResponse.json({ message: "Unknown provider" }, { status: 404 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const response = NextResponse.redirect(
    socialSignInUrl(provider as SocialProvider, `${origin}/auth/callback`)
  );

  const next = request.nextUrl.searchParams.get("next");
  if (next) {
    response.cookies.set(SOCIAL_NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
  }
  return response;
}
