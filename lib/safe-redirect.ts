/** Where a sign-in goes when it wasn't asked to go anywhere in particular. */
export const DEFAULT_NEXT = "/workspaces";

// Browsers drop tabs and line breaks from a URL and read a backslash as a slash, so "/<tab>/evil.example" is
// "//evil.example" to them: no control character or backslash is allowed anywhere in a destination.
const UNSAFE_CHARACTER = /[\u0000-\u001f\u007f\\]/;
const PROBE_ORIGIN = "http://redirect.invalid";

/** Only same-origin relative paths are allowed as post-auth destinations (prevents open redirects). */
export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || UNSAFE_CHARACTER.test(value)) return false;
  // The URL parser is the final word: whatever it is, it must stay on the same origin.
  return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
}

/** `value` when it is a safe destination, else the default one. */
export const safeNext = (value: unknown) => (isSafeRedirectPath(value) ? value : DEFAULT_NEXT);

/**
 * Every "Reconnect GitHub" link: the sign-in page for someone who is already signed in (without `reconnect=1` it would
 * send them straight on), returning to `next` once GitHub is authorized again.
 */
export function reconnectHref(next?: string) {
  return `/sign-in?reconnect=1&next=${encodeURIComponent(safeNext(next))}`;
}
