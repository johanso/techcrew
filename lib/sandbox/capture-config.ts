/**
 * Link references (a page the owner wants something similar to): the link check, what the capture runner gets and
 * returns, and the outline agents read. Pure; lib/sandbox/capture.ts runs the container, deploy/browser/capture.mjs
 * drives Chromium inside it. The address rules live in deploy/browser/net-guard.mjs, the one implementation both the
 * app and the runner use.
 */

import { CAPTURE_PORTS, CAPTURE_URL_MAX, checkCaptureUrl, internalHostReason, isAddressLiteral, isPublicAddress } from "@/deploy/browser/net-guard.mjs";
import { cleanReferenceName, imageDimensions, sniffImage } from "@/lib/reference-config";

export { CAPTURE_PORTS, CAPTURE_URL_MAX, internalHostReason, isAddressLiteral, isPublicAddress };

/** The capture containers' bridge network: internet, no traffic between containers, a fixed subnet for the firewall. */
export const CAPTURE_NETWORK = "techteam-capture";
export const CAPTURE_SUBNET = "172.31.253.0/24";
/** One capture: starting the container and Chromium, two page loads, the outline and two screenshots. */
export const CAPTURE_TIMEOUT_SECONDS = 100;
/** What the runner may spend on the pages; the rest is for starting up and writing the result. */
export const CAPTURE_RUNNER_BUDGET_MS = 80_000;
/** Screenshots are full-page up to this height (taller pages are cut there), as JPEG at this quality. */
export const CAPTURE_MAX_HEIGHT = 2_400;
export const CAPTURE_JPEG_QUALITY = 80;
export const CAPTURE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Characters of the page outline kept (local file) and given to agents. */
export const CAPTURE_OUTLINE_MAX = 8_000;
export const CAPTURE_WIDTHS = { desktop: 1280, mobile: 375 } as const;

export type CaptureUrl = { ok: true; url: string; hostname: string; port: number } | { ok: false; error: string };

/**
 * A link the owner pasted, checked before anything opens it: http or https, no credentials, ports 80, 443, 8080 or
 * 8443, and a host that isn't a private address or an internal name. Names are resolved and checked again by the app
 * (lib/sandbox/capture.ts) and, for every request the page makes, by the capture runner's proxy.
 */
export function parseCaptureUrl(raw: unknown): CaptureUrl {
  return checkCaptureUrl(raw) as CaptureUrl;
}

/** What capture.mjs reads on stdin. */
export type CaptureInput = { mode: "capture"; url: string; timeoutMs: number; maxHeight: number; quality: number };

export const captureInput = (url: string): CaptureInput => ({
  mode: "capture",
  url,
  timeoutMs: CAPTURE_RUNNER_BUDGET_MS,
  maxHeight: CAPTURE_MAX_HEIGHT,
  quality: CAPTURE_JPEG_QUALITY,
});

export type CaptureShot = { bytes: Uint8Array; width: number; height: number };

export type CaptureResult =
  | { ok: true; finalUrl: string | null; title: string | null; status: number | null; outline: unknown; desktop: CaptureShot; mobile: CaptureShot; blocked: string[] }
  | { ok: false; error: string; blocked: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : null);

/** A screenshot from the runner: a JPEG within the size limit whose header gives its real size. */
function decodeShot(raw: unknown, width: number): CaptureShot | null {
  if (!isRecord(raw) || typeof raw.base64 !== "string") return null;
  if (raw.base64.length > Math.ceil((CAPTURE_IMAGE_MAX_BYTES * 4) / 3) + 4) return null;
  const bytes = new Uint8Array(Buffer.from(raw.base64, "base64"));
  if (!bytes.length || bytes.length > CAPTURE_IMAGE_MAX_BYTES || sniffImage(bytes) !== "image/jpeg") return null;
  const size = imageDimensions(bytes, "image/jpeg");
  if (!size || size.width !== width || size.height > CAPTURE_MAX_HEIGHT) return null;
  return { bytes, ...size };
}

/** The runner's last stdout line, checked field by field (the page is untrusted, and so is what it made the runner say). */
export function parseCaptureOutput(stdout: string): CaptureResult | null {
  const line = stdout.trimEnd().split("\n").pop() ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const blocked = Array.isArray(raw.blocked)
    ? raw.blocked.slice(0, 20).flatMap((entry) => (isRecord(entry) && typeof entry.host === "string" ? [entry.host.slice(0, 200)] : []))
    : [];
  if (raw.ok !== true) return { ok: false, error: str(raw.error, 300) ?? "The page couldn't be captured.", blocked };
  const desktop = decodeShot(raw.desktop, CAPTURE_WIDTHS.desktop);
  const mobile = decodeShot(raw.mobile, CAPTURE_WIDTHS.mobile);
  if (!desktop || !mobile) return { ok: false, error: "The screenshots came back unreadable.", blocked };
  return {
    ok: true,
    finalUrl: str(raw.finalUrl, 2_000),
    title: str(raw.title, 300),
    status: typeof raw.status === "number" && Number.isInteger(raw.status) ? raw.status : null,
    outline: raw.outline,
    desktop,
    mobile,
    blocked,
  };
}

// ── Outline ────────────────────────────────────────────────────────────────────

/** One line of the page's words: no control characters or markup brackets, whitespace collapsed, clipped. */
export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Distinct, non-empty, cleaned strings, at most `count`. */
function texts(value: unknown, max: number, count: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, max);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= count) break;
  }
  return out;
}

/** "rgb(0, 85, 255)" or "rgba(0, 85, 255, 1)" → "#0055ff"; null for anything else (or a transparent color). */
export function cssColorHex(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  if (!(alpha > 0)) return null;
  const channels = [match[1], match[2], match[3]].map(Number);
  if (channels.some((n) => n > 255)) return null;
  return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const LANDMARK_ROLES = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search", "form", "region"]);

/**
 * The outline agents read for a link reference, from what the runner collected on the desktop page: title,
 * description, headings, landmarks, navigation, buttons, other links, form fields, the main texts and the main colors
 * and fonts.
 * Plain text, cleaned and capped (CAPTURE_OUTLINE_MAX): no HTML, no scripts, no URLs other than the page's own.
 */
export function formatCaptureOutline(input: { url: string; finalUrl: string | null; title: string | null; outline: unknown }) {
  const raw = isRecord(input.outline) ? input.outline : {};
  const lines: string[] = [`Captured from: ${input.url}`];
  if (input.finalUrl && input.finalUrl !== input.url) lines.push(`Redirected to: ${cleanText(input.finalUrl, 300)}`);
  const title = cleanText(raw.title ?? input.title, 200);
  if (title) lines.push(`Title: ${title}`);
  const description = cleanText(raw.description, 300);
  if (description) lines.push(`Description: ${description}`);
  const lang = cleanText(raw.lang, 20);
  if (lang) lines.push(`Language: ${lang}`);

  const headings = Array.isArray(raw.headings)
    ? raw.headings
        .flatMap((h) => {
          if (!isRecord(h)) return [];
          const level = typeof h.level === "number" && h.level >= 1 && h.level <= 6 ? Math.floor(h.level) : 2;
          const text = cleanText(h.text, 160);
          return text ? [`${"  ".repeat(Math.max(0, level - 1))}- h${level} ${text}`] : [];
        })
        .slice(0, 60)
    : [];
  if (headings.length) lines.push("Headings:", ...headings);

  const landmarks = Array.isArray(raw.landmarks)
    ? raw.landmarks.flatMap((l) => {
        if (!isRecord(l)) return [];
        const role = cleanText(l.role, 30).toLowerCase();
        if (!LANDMARK_ROLES.has(role)) return [];
        const label = cleanText(l.label, 60);
        return [label ? `${role} "${label}"` : role];
      })
    : [];
  if (landmarks.length) lines.push(`Landmarks: ${[...new Set(landmarks)].slice(0, 20).join(", ")}`);

  const nav = texts(raw.nav, 60, 30);
  if (nav.length) lines.push(`Navigation links: ${nav.join(" · ")}`);
  const buttons = texts(raw.buttons, 60, 20);
  if (buttons.length) lines.push(`Buttons: ${buttons.join(" · ")}`);
  const navSeen = new Set([...nav, ...buttons].map((text) => text.toLowerCase()));
  const links = texts(raw.links, 60, 40).filter((text) => !navSeen.has(text.toLowerCase())).slice(0, 30);
  if (links.length) lines.push(`Other links: ${links.join(" · ")}`);
  const fields = texts(raw.fields, 60, 20);
  if (fields.length) lines.push(`Form fields: ${fields.join(" · ")}`);
  const body = texts(raw.texts, 300, 30);
  if (body.length) lines.push("Main texts:", ...body.map((text) => `- ${text}`));
  if (typeof raw.images === "number" && raw.images > 0) lines.push(`Images and icons: ${Math.min(Math.floor(raw.images), 1_000)}`);

  const style: string[] = [];
  const fonts = texts(raw.fonts, 40, 4);
  if (fonts.length) style.push(`fonts ${fonts.join(", ")}`);
  const colors = isRecord(raw.colors) ? raw.colors : {};
  const background = cssColorHex(colors.background);
  const text = cssColorHex(colors.text);
  if (background) style.push(`background ${background}`);
  if (text) style.push(`text ${text}`);
  const accents = [...new Set((Array.isArray(colors.accents) ? colors.accents : []).map(cssColorHex).filter((c): c is string => c !== null && c !== background && c !== text))].slice(0, 5);
  if (accents.length) style.push(`accents ${accents.join(", ")}`);
  if (style.length) lines.push(`Style: ${style.join("; ")}`);

  const outline = lines.join("\n");
  return outline.length > CAPTURE_OUTLINE_MAX ? `${outline.slice(0, CAPTURE_OUTLINE_MAX - 30)}\n… [outline cut here]` : outline;
}

/** A link reference's display name: the page's title, else its host (and path). */
export function linkReferenceName(title: string | null, url: string) {
  const clean = cleanText(title, 100);
  if (clean) return cleanReferenceName(clean);
  try {
    const parsed = new URL(url);
    // Not cleanReferenceName: it would keep only the last path segment.
    return cleanText(`${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`, 120) || "link";
  } catch {
    return "link";
  }
}
