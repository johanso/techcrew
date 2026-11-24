import "server-only";

import { randomBytes } from "node:crypto";

import {
  BROWSE_TIMEOUT_SECONDS,
  decodeScreenshot,
  parseRunnerOutput,
  runnerInput,
  type BrowseRequest,
  type RunnerOutput,
} from "@/lib/sandbox/browser-config";
import { browserImage as image, dockerCli, dockerMode } from "@/lib/sandbox/cli";
import { previewTarget } from "@/lib/sandbox/config";
import { browserRunArgs } from "@/lib/sandbox/docker-args";

/**
 * The Tester's browser: one throwaway container per browse_preview call (deploy/browser), attached only to the run's
 * preview network (previewTarget), which is internal: no internet, only the preview. It opens the preview's internal
 * URL, runs the steps and returns what it saw. The request goes in as JSON on stdin, never as a shell argument.
 * Hardening matches lib/sandbox/docker.ts (lib/sandbox/docker-args.ts has the flags): gVisor on a remote host, no
 * capabilities, no-new-privileges, an unprivileged user, a read-only root, CPU, memory, process and time limits.
 */

const INSPECT_TIMEOUT_MS = 30_000;

/**
 * The preview container's address on its network, or null when no preview is running. The network must be internal:
 * the browser never joins a network with a route out, whatever created it.
 */
async function previewAddress(runId: number): Promise<string | null> {
  const target = previewTarget(runId);
  // Containers appear in a network's list only while they run.
  const inspected = await dockerCli(
    ["network", "inspect", "--format", "{{.Internal}}{{range .Containers}} {{.Name}}={{.IPv4Address}}{{end}}", target.network],
    { timeoutMs: INSPECT_TIMEOUT_MS }
  );
  if (inspected.code !== 0) return null;
  const [internal, ...members] = inspected.stdout.trim().split(/\s+/);
  if (internal !== "true") return null;
  const address = members.find((member) => member.startsWith(`${target.container}=`))?.split("=")[1]?.split("/")[0];
  return address && /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? address : null;
}

export type BrowseRun =
  | { kind: "no_preview" }
  | { kind: "failed"; reason: string }
  | { kind: "timed_out"; durationMs: number }
  | { kind: "done"; output: Omit<RunnerOutput, "screenshot">; screenshot: Buffer | null };

// One browser at a time per run: Chromium is the heaviest thing on the host, and a turn may batch several calls.
const queues = new Map<number, Promise<unknown>>();

function serialized<T>(runId: number, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(runId, next);
  void next.finally(() => {
    if (queues.get(runId) === next) queues.delete(runId);
  });
  return next;
}

/**
 * Opens `request.path` on the run's preview in a fresh headless Chromium, runs the steps in order and returns what the
 * page showed. Never throws for what happens in the browser or when no preview runs; throws only when Docker itself
 * can't be reached.
 */
export function browsePreview(runId: number, request: BrowseRequest): Promise<BrowseRun> {
  return serialized(runId, async () => {
    const started = Date.now();
    const target = previewTarget(runId);
    const address = await previewAddress(runId);
    if (!address) return { kind: "no_preview" };

    const name = `techteam-browser-run-${runId}-${randomBytes(3).toString("hex")}`;
    const run = await dockerCli(browserRunArgs({ mode: dockerMode(), name, network: target.network, container: target.container, address, image: image() }), { input: JSON.stringify(runnerInput(request, target.internalUrl)), timeoutMs: started + BROWSE_TIMEOUT_SECONDS * 1000 - Date.now(), name }
    );
    if (run.timedOut) return { kind: "timed_out", durationMs: Date.now() - started };
    const output = parseRunnerOutput(run.stdout);
    if (!output) {
      if (/Unable to find image|No such image/i.test(run.stderr)) {
        console.error(`[browser] ${image()} isn't on the sandbox host: build it from deploy/browser (npm run sandbox:setup, or deploy/setup.sh on a remote host).`);
        return { kind: "failed", reason: "the browser isn't installed on the sandbox host." };
      }
      // The container's own words stay out of the report: they may echo the page.
      console.error("[browser] runner failed", run.code, run.stderr.slice(-500));
      return { kind: "failed", reason: run.code === 137 ? "the browser ran out of memory." : "the browser couldn't start or crashed." };
    }
    const { screenshot, ...rest } = output;
    return { kind: "done", output: rest, screenshot: decodeScreenshot(screenshot) };
  });
}
