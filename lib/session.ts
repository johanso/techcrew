import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { decrypt, encrypt } from "@/lib/crypto";
import { getSessionSecret } from "@/lib/secrets";
import { SESSION_COOKIE, SESSION_TTL_MS, cookieIsSecure } from "@/lib/session-config";

/**
 * Stateless sessions: a cookie holding `<payload>.<expiresAtMs>.<hmac>`, HMAC-SHA256 over the first two parts with the
 * secret in the data dir. No table and no remote call; signing out clears the cookie, and replacing the secret signs
 * everyone out. The same seal protects the short-lived sign-in cookies.
 */

const mac = (data: string, secret: Buffer) => createHmac("sha256", secret).update(data).digest("base64url");

/** Seals `payload` (no dots: base64url or digits) until `expiresAtMs`. */
export function seal(payload: string, expiresAtMs: number, secret: Buffer) {
  const body = `${payload}.${Math.floor(expiresAtMs)}`;
  return `${body}.${mac(body, secret)}`;
}

/** The payload of a sealed value, or null when it is malformed, forged, signed with another secret or expired. */
export function unseal(value: string | undefined, secret: Buffer, now: number): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [payload, expires, signature] = parts;
  if (!payload || !/^\d{1,16}$/.test(expires)) return null;
  const expected = Buffer.from(mac(`${payload}.${expires}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(expires) > now ? payload : null;
}

export const signSession = (userId: number, expiresAtMs: number, secret: Buffer) => seal(String(userId), expiresAtMs, secret);

/** The user id of a valid session value, or null. */
export function verifySession(value: string | undefined, secret: Buffer, now: number): number | null {
  const payload = unseal(value, secret, now);
  if (!payload || !/^\d{1,15}$/.test(payload)) return null;
  const id = Number(payload);
  return id > 0 ? id : null;
}

const cookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: cookieIsSecure(process.env.NEXT_PUBLIC_APP_URL),
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

/** Signs the owner in: sets the session cookie. Server actions and route handlers only. */
export async function startSession(userId: number) {
  const value = signSession(userId, Date.now() + SESSION_TTL_MS, getSessionSecret());
  (await cookies()).set(SESSION_COOKIE, value, cookieOptions(SESSION_TTL_MS));
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user's id from the request's cookie, or null. */
export async function getSessionUserId() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, getSessionSecret(), Date.now());
}

/**
 * A short-lived cookie holding JSON the browser's scripts never see (httpOnly) and nobody can alter (sealed).
 * `encrypted` also hides it from the person at the keyboard: used where it holds a GitHub token.
 */
export async function writeSealedCookie(name: string, value: unknown, ttlMs: number, options: { encrypted?: boolean } = {}) {
  const json = JSON.stringify(value);
  const payload = Buffer.from(options.encrypted ? encrypt(json) : json, "utf8").toString("base64url");
  (await cookies()).set(name, seal(payload, Date.now() + ttlMs, getSessionSecret()), cookieOptions(ttlMs));
}

/** The JSON of a sealed cookie, or null when it is missing, forged, expired or unreadable. */
export async function readSealedCookie(name: string, options: { encrypted?: boolean } = {}): Promise<unknown> {
  const payload = unseal((await cookies()).get(name)?.value, getSessionSecret(), Date.now());
  if (!payload) return null;
  try {
    const text = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(options.encrypted ? decrypt(text) : text);
  } catch {
    return null;
  }
}

export async function clearCookie(name: string) {
  (await cookies()).delete(name);
}
