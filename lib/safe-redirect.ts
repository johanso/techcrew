/** Where a sign-in goes when it wasn't asked to go anywhere in particular. */
export const DEFAULT_NEXT = "/workspaces";

/** Only same-origin relative paths are allowed as post-auth destinations (prevents open redirects). */
export function isSafeRedirectPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
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
