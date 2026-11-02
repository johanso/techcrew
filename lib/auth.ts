import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

/**
 * Server-side client for the hosted Better Auth service (CloudHike.dev Auth).
 *
 * The service is token based: sign-in returns a session token that we keep in an
 * HTTP-only cookie and forward as `authorization: Bearer <token>`. The token never
 * reaches browser JavaScript.
 */

const AUTH_URL = process.env.AUTH_URL!;
const AUTH_PUBLISHABLE_KEY = process.env.AUTH_PUBLISHABLE_KEY!;

export const SESSION_COOKIE = "session_token";
/** Remembers where to send the user after a social sign-in round trip. */
export const SOCIAL_NEXT_COOKIE = "auth_next";
export const SOCIAL_PROVIDERS = ["github", "google"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export type AuthUser = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  session: { id: string; userId: string; expiresAt: string };
  user: AuthUser;
};

/** Only same-origin relative paths are allowed as post-auth destinations (prevents open redirects). */
export function isSafeRedirectPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AuthError";
  }
}

async function authRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-api-key": AUTH_PUBLISHABLE_KEY,
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new AuthError(data?.message ?? "Authentication service error", res.status);
  }
  return data as T;
}

export function signUpWithEmail(input: { name: string; email: string; password: string }) {
  return authRequest<{ token: string | null; user: AuthUser }>("/sign-up/email", {
    method: "POST",
    body: input,
  });
}

export function signInWithEmail(input: { email: string; password: string }) {
  return authRequest<{ token: string; user: AuthUser }>("/sign-in/email", {
    method: "POST",
    body: input,
  });
}

export async function fetchSession(token: string): Promise<AuthSession | null> {
  try {
    return await authRequest<AuthSession | null>("/get-session", { token });
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) return null;
    throw error;
  }
}

export async function revokeSession(token: string) {
  await authRequest("/sign-out", { method: "POST", token }).catch(() => {});
}

/** URL that starts the provider's OAuth flow; it returns to `returnTo` with `#token=…`. */
export function socialSignInUrl(provider: SocialProvider, returnTo: string) {
  return `${AUTH_URL}/social/${provider}?to=${encodeURIComponent(returnTo)}`;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Validated session for the current request (deduplicated per render). */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return fetchSession(token);
});
