// DNS-rebinding guard, pure so proxy.ts can import it. The app listens on the loopback address only, but a web page
// on the internet can point its own domain at 127.0.0.1 and have the visitor's browser talk to the app under that
// name. Such a request carries the attacker's domain in `Host`, so only the names this computer answers to pass.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The hostname of a `Host` header value: lowercase, port and trailing dot removed, IPv6 keeps its brackets. */
export function hostnameOf(host: string | null | undefined): string | null {
  // Anything that isn't `name[:port]` or `[ipv6][:port]` (userinfo, paths, spaces) is not a Host header.
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/.exec(host?.trim().toLowerCase() ?? "");
  const hostname = match?.[1];
  const bare = hostname?.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return bare || null;
}

/** Whether a request's `Host` is localhost, 127.0.0.1, [::1] (any port) or the host of NEXT_PUBLIC_APP_URL. */
export function isAllowedHost(host: string | null | undefined, appUrl?: string) {
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  if (!appUrl?.trim()) return false;
  try {
    return hostnameOf(new URL(appUrl).host) === hostname;
  } catch {
    return false;
  }
}
