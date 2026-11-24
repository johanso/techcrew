/** Only same-origin relative paths are allowed as post-auth destinations (prevents open redirects). */
export function isSafeRedirectPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}
