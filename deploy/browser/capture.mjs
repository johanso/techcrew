// A link reference's capture ("capture" mode of run.mjs; lib/sandbox/capture.ts runs it): opens one public page at
// desktop (1280 px) and mobile (375 px) width and returns two JPEG screenshots plus a short outline of the page.
// Input and output shapes: CaptureInput / CaptureRunnerOutput in lib/sandbox/capture-config.ts.
//
// The container has internet (its own bridge network, techteam-capture), but every connection Chromium makes goes
// through the proxy below, which resolves the name itself (public resolvers, not the host's), refuses the request when
// any address is private, loopback, link-local (cloud metadata), CGNAT or otherwise non-public (net-guard.mjs), and
// then connects to the address it checked, so a name that answers differently the second time (DNS rebinding) gets
// nowhere. Redirects and subresources are new requests, so they go through the same check. The page itself never
// resolves names (it has no working DNS: Docker's resolver doesn't answer under gVisor). WebSockets, media, service
// workers, downloads and popups are off; QUIC and WebRTC UDP are off (they'd skip the proxy). The host's firewall
// (deploy/setup.sh) refuses the same ranges for this network, in case anything slips past.
import dns from "node:dns";
import http from "node:http";
import net from "node:net";

import { chromium } from "playwright-core";

import { CAPTURE_PORTS, checkCaptureUrl, internalHostReason, isAddressLiteral, isPublicAddress } from "./net-guard.mjs";

const RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};
const NAVIGATION_TIMEOUT_MS = 20_000;
const LOAD_WAIT_MS = 8_000;
const SETTLE_MS = 3_000;
const CONNECT_TIMEOUT_MS = 15_000;
// What the page may download in all (both viewports) and how many connections it may open.
const BYTES_MAX = 60 * 1024 * 1024;
const CONNECTIONS_MAX = 400;
const BLOCKED_KEEP = 20;
// Marks the proxy's own refusal of a plain http:// request (https:// refusals fail the tunnel instead).
const BLOCKED_HEADER = "x-techteam-capture-blocked";

// QUIC and WebRTC's UDP would not go through the proxy.
const CAPTURE_ARGS = ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--webrtc-ip-handling-policy=disable_non_proxied_udp"];

const firstLine = (error) => String(error instanceof Error ? error.message : error).split("\n", 1)[0].slice(0, 300);

/** The proxy every request of the page goes through: resolve, check, connect to the checked address. */
async function startProxy(state) {
  const resolver = new dns.promises.Resolver({ timeout: 4_000, tries: 2 });
  resolver.setServers(RESOLVERS);
  const answers = new Map();
  const sockets = new Set();

  const refuse = (host, reason) => {
    state.lastRefused = { host, reason };
    if (state.blocked.length < BLOCKED_KEEP && !state.blocked.some((entry) => entry.host === host)) state.blocked.push({ host, reason });
    return { ok: false, reason };
  };

  const lookup = async (host) => {
    if (isAddressLiteral(host)) return isPublicAddress(host) ? [host.replace(/^\[|\]$/g, "")] : null;
    if (internalHostReason(host)) return null;
    const [v4, v6] = await Promise.all([resolver.resolve4(host).catch(() => []), resolver.resolve6(host).catch(() => [])]);
    return [...v4, ...v6];
  };

  /** The checked address to connect to, or why not. Every answer must be public, not just the one we'd use. */
  const allowed = async (rawHost, port) => {
    const host = rawHost.toLowerCase();
    if (++state.connections > CONNECTIONS_MAX) return refuse(host, "too many connections");
    if (state.overBudget) return refuse(host, "download limit reached");
    if (!CAPTURE_PORTS.includes(port)) return refuse(host, "port not allowed");
    let addresses = answers.get(host);
    if (!addresses) {
      addresses = lookup(host);
      answers.set(host, addresses);
    }
    const list = await addresses;
    if (list === null) return refuse(host, "private");
    if (!list.length) return refuse(host, "not found");
    if (list.some((address) => !isPublicAddress(address))) return refuse(host, "private");
    // IPv4 first: Docker bridges have no IPv6 route unless the daemon enables it.
    return { ok: true, address: list.find((address) => !address.includes(":")) ?? list[0] };
  };

  const count = (chunk) => {
    state.bytes += chunk.length;
    if (state.bytes > BYTES_MAX && !state.overBudget) {
      state.overBudget = true;
      for (const socket of sockets) socket.destroy();
    }
  };
  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  // Plain http:// requests arrive with the absolute URL.
  const server = http.createServer(async (req, res) => {
    let target;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const checked = await allowed(target.hostname, port);
    if (!checked.ok) {
      res.writeHead(403, { "content-type": "text/plain", [BLOCKED_HEADER]: "1" }).end("Blocked by the capture proxy.");
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      { host: checked.address, port, method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false, timeout: CONNECT_TIMEOUT_MS },
      (response) => {
        response.on("data", count);
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      }
    );
    upstream.on("socket", track);
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // https:// (and anything else tunnelled) arrives as CONNECT host:port.
  server.on("connect", async (req, client, head) => {
    track(client);
    client.on("error", () => undefined);
    const match = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]+):(\d{1,5})$/.exec(req.url ?? "");
    if (!match) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const port = Number(match[2]);
    const checked = await allowed(match[1], port);
    if (!checked.ok) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host: checked.address, port, timeout: CONNECT_TIMEOUT_MS }, () => {
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("data", count);
    const close = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("timeout", close);
    upstream.on("error", close);
    client.on("close", () => upstream.destroy());
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/** Runs in the page: what's on it, as plain strings (the app trims and caps them again: they're the page's words). */
function collectOutline() {
  const clean = (text, max = 300) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const take = (selector, max) => [...document.querySelectorAll(selector)].filter(visible).slice(0, max);
  const nameOf = (el) => clean(el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("alt") || el.value || "", 80);
  const ROLE = { HEADER: "banner", NAV: "navigation", MAIN: "main", ASIDE: "complementary", FOOTER: "contentinfo", FORM: "form" };
  const opaque = (color) => color && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color);

  const main = document.querySelector("main, [role=main]") ?? document.body;
  const fonts = [document.body, ...take("h1, h2, button", 10)]
    .filter(Boolean)
    .map((el) => clean(getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, ""), 60));
  const accents = [
    ...take("button, [role=button], a[class*=btn], a[class*=button]", 20).map((el) => getComputedStyle(el).backgroundColor),
    ...take("a", 20).map((el) => getComputedStyle(el).color),
  ].filter(opaque);
  const background = [document.body, document.documentElement].map((el) => el && getComputedStyle(el).backgroundColor).find(opaque) ?? null;

  return {
    title: clean(document.title, 200),
    description: clean(document.querySelector('meta[name="description"]')?.getAttribute("content"), 300),
    lang: clean(document.documentElement.lang, 20),
    headings: take("h1, h2, h3, h4", 60).map((el) => ({ level: Number(el.tagName[1]), text: clean(el.innerText, 160) })),
    landmarks: take("header, nav, main, aside, footer, [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=search]", 30).map(
      (el) => ({ role: el.getAttribute("role") || ROLE[el.tagName] || el.tagName.toLowerCase(), label: clean(el.getAttribute("aria-label"), 60) })
    ),
    nav: take("nav a, header a, [role=navigation] a", 60).map(nameOf),
    buttons: take("button, [role=button], input[type=submit], a[class*=btn], a[class*=button]", 40).map(nameOf),
    // Pages without landmarks (tables, divs) still show their structure through their links.
    links: [...main.querySelectorAll("a")].filter(visible).slice(0, 80).map(nameOf),
    fields: take("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select", 30).map((el) => {
      const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
      return clean(label?.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.type, 60);
    }),
    texts: [...main.querySelectorAll("p, li, blockquote, figcaption, dd")]
      .filter(visible)
      .map((el) => clean(el.innerText, 300))
      .filter((text) => text.length >= 20)
      .slice(0, 40),
    images: take("img, picture, svg, video", 1_000).length,
    fonts,
    colors: { background, text: document.body ? getComputedStyle(document.body).color : null, accents: accents.slice(0, 30) },
  };
}

// Scrolls through what will be captured so lazy images load, then back to the top.
async function scrollThrough(maxHeight) {
  const step = Math.max(200, window.innerHeight);
  const end = Math.min(maxHeight, document.documentElement.scrollHeight);
  for (let y = step; y < end; y += step) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** Why the page couldn't be opened, in the owner's words. */
function openError(error, state, host) {
  const text = firstLine(error);
  const refused = state.lastRefused && (state.lastRefused.host === host || /^blocked$|TUNNEL|ERR_ABORTED|ERR_BLOCKED/i.test(text)) ? state.lastRefused : null;
  if (refused?.reason === "private") return "That link (or a page it redirects to) is on a private or internal network. Use a public address.";
  if (refused?.reason === "not found") return `We couldn't find ${refused.host}: the name doesn't resolve.`;
  if (refused?.reason === "port not allowed") return `That link redirects to a port other than ${CAPTURE_PORTS.join(", ")}.`;
  if (refused) return "The page loads too much to capture.";
  if (/Timeout/i.test(text)) return "The page took too long to load.";
  if (/ERR_CERT|SSL/i.test(text)) return "The site's HTTPS certificate isn't valid.";
  if (/ERR_TOO_MANY_REDIRECTS/i.test(text)) return "The link redirects too many times.";
  return `The page couldn't be opened (${text.replace(/^page\.goto:\s*/i, "")}).`;
}

async function shoot(browser, name, url, input, deadline, state, out) {
  const remaining = () => deadline - Date.now();
  const preset = VIEWPORTS[name];
  const context = await browser.newContext({ ...preset, deviceScaleFactor: 1, colorScheme: "light", serviceWorkers: "block", acceptDownloads: false, locale: "en-US" });
  try {
    await context.route("**/*", (route) => {
      const request = route.request();
      let target;
      try {
        target = new URL(request.url());
      } catch {
        return route.abort("blockedbyclient");
      }
      // The proxy checks every connection; this fails the obvious ones at once and keeps heavy media out.
      const host = target.hostname;
      const internal = isAddressLiteral(host) ? !isPublicAddress(host) : internalHostReason(host) !== null;
      if ((target.protocol !== "http:" && target.protocol !== "https:") || internal) {
        state.lastRefused = { host, reason: "private" };
        if (state.blocked.length < BLOCKED_KEEP && !state.blocked.some((entry) => entry.host === host)) state.blocked.push({ host, reason: "private" });
        return route.abort("blockedbyclient");
      }
      if (["media", "websocket", "eventsource"].includes(request.resourceType())) return route.abort("blockedbyclient");
      return route.continue();
    });
    await context.routeWebSocket(/.*/, (socket) => socket.close());
    const page = await context.newPage();
    context.on("page", (other) => {
      if (other !== page) void other.close().catch(() => undefined);
    });

    let response;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(1, Math.min(NAVIGATION_TIMEOUT_MS, remaining())) });
    } catch (error) {
      out.error = openError(error, state, new URL(url).hostname);
      return null;
    }
    if (response?.headers()[BLOCKED_HEADER]) {
      out.error = openError(new Error("blocked"), state, new URL(response.url()).hostname);
      return null;
    }
    if (name === "desktop") {
      out.status = response?.status() ?? null;
      if (out.status !== null && out.status >= 400) {
        out.error = `The page answered with HTTP ${out.status}.`;
        return null;
      }
    }
    await page.waitForLoadState("load", { timeout: Math.max(1, Math.min(LOAD_WAIT_MS, remaining())) }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: Math.max(1, Math.min(SETTLE_MS, remaining())) }).catch(() => undefined);
    await page.evaluate(scrollThrough, input.maxHeight).catch(() => undefined);
    if (name === "desktop") {
      out.finalUrl = page.url();
      out.title = await page.title().catch(() => null);
      out.outline = await page.evaluate(collectOutline).catch(() => null);
    }
    if (remaining() < 3_000) {
      out.timedOut = true;
      out.error = "The page took too long to load.";
      return null;
    }
    const scrollHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
    const width = preset.viewport.width;
    const height = Math.max(preset.viewport.height, Math.min(scrollHeight || preset.viewport.height, input.maxHeight));
    const jpeg = await page.screenshot({
      type: "jpeg",
      quality: input.quality,
      fullPage: true,
      clip: { x: 0, y: 0, width, height },
      animations: "disabled",
      caret: "hide",
      timeout: Math.max(1, Math.min(15_000, remaining())),
    });
    return { base64: jpeg.toString("base64"), width, height };
  } catch (error) {
    out.error = /Timeout/i.test(firstLine(error)) ? "The page took too long to load." : `The page couldn't be captured (${firstLine(error)}).`;
    return null;
  } finally {
    await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]).catch(() => undefined);
  }
}

/** Captures `input.url` at desktop and mobile width. Never throws for what the page does; `ok` says if both worked. */
export async function capture(input, baseArgs) {
  const out = { ok: false, error: null, status: null, finalUrl: null, title: null, outline: null, desktop: null, mobile: null, blocked: [], bytes: 0, timedOut: false };
  const checked = checkCaptureUrl(input.url);
  if (!checked.ok) {
    out.error = checked.error;
    return out;
  }
  const deadline = Date.now() + input.timeoutMs;
  const state = { bytes: 0, overBudget: false, connections: 0, blocked: [], lastRefused: null };
  const proxy = await startProxy(state);
  // Every connection through the proxy; "<-loopback>" removes Chromium's implicit bypass for localhost addresses.
  const browser = await chromium.launch({
    args: [...baseArgs, ...CAPTURE_ARGS],
    chromiumSandbox: true,
    timeout: 30_000,
    proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" },
  });
  try {
    for (const name of ["desktop", "mobile"]) {
      const shot = await shoot(browser, name, checked.url, input, deadline, state, out);
      if (!shot) break;
      out[name] = shot;
    }
    out.ok = Boolean(out.desktop && out.mobile);
  } finally {
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]).catch(() => undefined);
    proxy.close();
    out.blocked = state.blocked;
    out.bytes = state.bytes;
  }
  return out;
}
