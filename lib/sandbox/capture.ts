import "server-only";

import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";

import { BROWSER_LIMITS, browserImage, dockerCli } from "@/lib/sandbox/browser";
import {
  CAPTURE_NETWORK,
  CAPTURE_SUBNET,
  CAPTURE_TIMEOUT_SECONDS,
  captureInput,
  isPublicAddress,
  parseCaptureOutput,
  parseCaptureUrl,
  type CaptureResult,
} from "@/lib/sandbox/capture-config";
import { ensureBridgeNetwork, sandboxHost } from "@/lib/sandbox/docker";

/**
 * Link references: captures a public page once, when the owner adds it, in a throwaway browser container on the
 * sandbox host (deploy/browser/capture.mjs). Unlike browse_preview the container has internet, on its own bridge
 * network (techteam-capture: no traffic between containers, a fixed subnet the host firewall knows), and nothing
 * internal: every request goes through the runner's proxy, which resolves the name itself and connects only to public
 * addresses (deploy/browser/net-guard.mjs). The host's ufw rules refuse anything from a bridge to the host itself, and
 * deploy/setup.sh adds rules refusing this subnet's traffic to private ranges (the same rules as the sandbox's install
 * network; ensureBridgeNetwork creates either on first use). Same limits as the Tester's browser.
 */

/** The server can capture links: it has a sandbox host (SANDBOX_DOCKER_HOST). */
export function linkCaptureAvailable() {
  return sandboxHost() !== null;
}

/**
 * The app's own check of the name before a container starts: every address it resolves to here must be public. The
 * runner checks again for every request (with its own resolver), which is what counts; this one answers fast.
 */
async function precheckHost(hostname: string): Promise<string | null> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
  } catch {
    return `We couldn't find ${hostname}: check the link.`;
  }
  if (!addresses.length) return `We couldn't find ${hostname}: check the link.`;
  if (addresses.some(({ address }) => !isPublicAddress(address))) return "That link points to a private or internal network. Use a public address.";
  return null;
}

// Captures get two cores (the sandbox host needs at least two): a heavy page loaded twice on one core under gVisor
// takes about 45 s. They run one at a time, so it's never more than that.
const CAPTURE_LIMITS = BROWSER_LIMITS.map((flag) => (flag.startsWith("--cpus=") ? "--cpus=2" : flag));

// One capture at a time per app process: Chromium is the heaviest thing on the sandbox host.
let queue: Promise<unknown> = Promise.resolve();

export type CaptureOutcome = { ok: true; url: string; value: Extract<CaptureResult, { ok: true }> } | { ok: false; error: string };

/**
 * Captures `rawUrl`: desktop and mobile screenshots and the page's outline. Never throws for what the page does; a
 * failure comes back as a message for the owner (and is logged without page content).
 */
export function captureLink(rawUrl: string): Promise<CaptureOutcome> {
  const next = queue.catch(() => undefined).then(() => capture(rawUrl));
  queue = next;
  return next;
}

async function capture(rawUrl: string): Promise<CaptureOutcome> {
  const parsed = parseCaptureUrl(rawUrl);
  if (!parsed.ok) return parsed;
  if (!linkCaptureAvailable()) return { ok: false, error: "Links need a sandbox host (SANDBOX_DOCKER_HOST) to be captured." };
  const refused = await precheckHost(parsed.hostname);
  if (refused) return { ok: false, error: refused };
  const networkProblem = await ensureBridgeNetwork({ name: CAPTURE_NETWORK, subnet: CAPTURE_SUBNET, label: "techteam.capture=1", what: "capture network" });
  if (networkProblem) return { ok: false, error: networkProblem };

  const name = `techteam-capture-${randomBytes(4).toString("hex")}`;
  const started = Date.now();
  const run = await dockerCli(
    ["run", "--rm", "-i", `--name=${name}`, ...CAPTURE_LIMITS, "--label=techteam.capture=1", `--network=${CAPTURE_NETWORK}`, browserImage()],
    { input: JSON.stringify(captureInput(parsed.url)), timeoutMs: CAPTURE_TIMEOUT_SECONDS * 1000, name }
  );
  if (run.timedOut) return { ok: false, error: "The page took too long to capture. Try again, or a lighter page." };
  const result = parseCaptureOutput(run.stdout);
  if (!result) {
    if (/Unable to find image|No such image/i.test(run.stderr)) {
      console.error(`[capture] ${browserImage()} isn't on the sandbox host: build it from deploy/browser (docs/sandbox.md).`);
      return { ok: false, error: "The browser isn't installed on the sandbox host yet." };
    }
    console.error("[capture] runner failed", run.code, run.stderr.slice(-500));
    return { ok: false, error: run.code === 137 ? "The page used too much memory to capture." : "The browser couldn't start or crashed. Please try again." };
  }
  if (result.blocked.length) console.info(`[capture] ${parsed.hostname}: blocked ${result.blocked.length} host(s) on private or internal networks`, result.blocked);
  if (!result.ok) return { ok: false, error: result.error };
  console.info(`[capture] ${parsed.hostname} captured in ${Date.now() - started} ms`);
  return { ok: true, url: parsed.url, value: result };
}
