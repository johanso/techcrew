// Which addresses a captured page may reach: the public internet only. One implementation for both sides: the app
// imports it (lib/sandbox/capture-config.ts) to check a link before it starts a container, and the capture runner
// (run.mjs) checks every address its proxy connects to, after resolving the name itself (no DNS rebinding: the
// proxy connects to the address it checked). Pure: no imports, so it runs in Node, the app and the tests alike.

/** Ports a captured page may use: the web's defaults and their usual alternates. */
export const CAPTURE_PORTS = [80, 443, 8080, 8443];
export const CAPTURE_URL_MAX = 2_000;

// Names that never belong to a public site (RFC 6761, 6762, 8375 and common internal suffixes).
const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "intranet", "lan", "home", "corp", "home.arpa", "localdomain", "test", "invalid", "example", "onion"];

/**
 * Four octets from a dotted-decimal IPv4 address, or null. Only the canonical form: the URL parser already turns
 * "2130706433", "0x7f.1" or "127.1" into "127.0.0.1", and anything else isn't an address.
 * @param {string} text
 * @returns {number[] | null}
 */
export function parseIPv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Eight 16-bit groups from an IPv6 address ("::1", "[2001:db8::1]", "::ffff:127.0.0.1"), or null. Zone ids
 * ("fe80::1%eth0") are refused: they only make sense on a local link.
 * @param {string} raw
 * @returns {number[] | null}
 */
export function parseIPv6(raw) {
  let text = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (!text.includes(":") || text.includes("%")) return null;
  // An IPv4 tail ("::ffff:1.2.3.4") is two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = parseIPv4(tail[2]);
    if (!v4) return null;
    text = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (half) => (half === "" ? [] : half.split(":"));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const out = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

/**
 * Whether an IPv4 address is on the public internet: not "this network", private (RFC 1918), shared/CGNAT
 * (100.64/10), loopback, link-local (169.254/16: cloud metadata lives there), IETF protocol assignments, the
 * documentation and benchmarking ranges, 6to4 relays, multicast, reserved or broadcast.
 * @param {number[]} o
 */
export function isPublicIPv4(o) {
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/**
 * Whether an IPv6 address is on the public internet: global unicast (2000::/3) only, minus documentation
 * (2001:db8::/32), Teredo (2001::/32), ORCHID and benchmarking (2001:2::/48, 2001:10::/28, 2001:20::/28) and 6to4
 * (2002::/16, which wraps an IPv4 address). Everything outside 2000::/3 is refused: loopback, unspecified,
 * IPv4-mapped and -compatible, NAT64 (64:ff9b::/96 wraps IPv4), unique local (fc00::/7), link-local (fe80::/10),
 * multicast.
 * @param {number[]} g
 */
export function isPublicIPv6(g) {
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false;
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return false;
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return false;
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0020) return false;
  if (g[0] === 0x2002) return false;
  return true;
}

/**
 * Whether `address` (IPv4 or IPv6, brackets allowed) is a public internet address. Anything that isn't an address is
 * false.
 * @param {string} address
 */
export function isPublicAddress(address) {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}

/** Whether `hostname` is an IP address literal (IPv4 or bracketed IPv6). @param {string} hostname */
export const isAddressLiteral = (hostname) => parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;

/**
 * Why a host name can't be a public site, or null: single-label names ("intranet") and internal suffixes
 * ("printer.local", "db.internal", "localhost"). Addresses are checked with isPublicAddress instead.
 * @param {string} hostname lowercase, as the URL parser gives it
 */
export function internalHostReason(hostname) {
  const name = hostname.replace(/\.$/, "");
  if (!name || name.length > 253) return "That isn't a valid host name.";
  if (!name.includes(".")) return "Use a public address: a name with a domain, like example.com.";
  const lower = name.toLowerCase();
  if (INTERNAL_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`))) {
    return "That name points to a private or internal network. Use a public address.";
  }
  return null;
}

/**
 * Checks a link before anything opens it: http or https, no user name or password, a usual web port, a public host
 * (a public IP address, or a name that isn't internal). Names are resolved later, by whoever connects, and their
 * addresses checked with isPublicAddress.
 * @param {unknown} raw
 * @returns {{ ok: true, url: string, hostname: string, port: number } | { ok: false, error: string }}
 */
export function checkCaptureUrl(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Paste a link starting with https://." };
  if (text.length > CAPTURE_URL_MAX) return { ok: false, error: `Links can be up to ${CAPTURE_URL_MAX} characters.` };
  if (/[\u0000-\u001f\u007f\s\\]/.test(text)) return { ok: false, error: "That link has characters a web address can't have." };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a valid link. Paste the full address, starting with https://." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Use an http or https link." };
  if (url.username || url.password) return { ok: false, error: "Remove the user name and password from the link." };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!CAPTURE_PORTS.includes(port)) return { ok: false, error: `Use a link on a standard web port (${CAPTURE_PORTS.join(", ")}).` };
  const hostname = url.hostname.toLowerCase();
  if (isAddressLiteral(hostname)) {
    if (!isPublicAddress(hostname)) return { ok: false, error: "That address is on a private or internal network. Use a public address." };
  } else {
    const reason = internalHostReason(hostname);
    if (reason) return { ok: false, error: reason };
  }
  url.hash = "";
  return { ok: true, url: url.href, hostname, port };
}
