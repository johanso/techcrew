// Cookie names and lifetimes shared by the session code and proxy.ts. Pure, so the proxy can import it.

/** The signed session: `<userId>.<expiresAtMs>.<hmac>` (lib/session.ts). */
export const SESSION_COOKIE = "tt_session";
/** The device flow in progress: GitHub's device code, kept out of the browser's JavaScript. */
export const LOGIN_COOKIE = "tt_login";
/** A sign-in waiting for the owner to adopt the existing data (sealed and encrypted: it holds the GitHub token). */
export const ADOPT_COOKIE = "tt_adopt";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How long the owner has to answer the adopt question. */
export const ADOPT_TTL_MS = 10 * 60 * 1000;

/** `secure` only on https: a plain `http://127.0.0.1` page would never get the cookie back otherwise. */
export function cookieIsSecure(appUrl: string | undefined) {
  return Boolean(appUrl) && appUrl!.trim().toLowerCase().startsWith("https://");
}
