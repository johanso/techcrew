import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  BROWSER_IMAGE,
  BROWSE_TIMEOUT_SECONDS,
  decodeScreenshot,
  parseRunnerOutput,
  runnerInput,
  type BrowseRequest,
  type RunnerOutput,
} from "@/lib/sandbox/browser-config";
import { previewTarget } from "@/lib/sandbox/config";
import { sandboxHost } from "@/lib/sandbox/docker";

/**
 * The Tester's browser: one throwaway container per browse_preview call (deploy/browser), attached only to the run's
 * preview network (previewTarget), which is internal: no internet, only the preview. It opens the preview's internal
 * URL, runs the steps and returns what it saw. The request goes in as JSON on stdin, never as a shell argument.
 * Hardening matches lib/sandbox/docker.ts: gVisor, no capabilities, no-new-privileges, an unprivileged user, a
 * read-only root, CPU, memory, process and time limits.
 */

const image = () => process.env.SANDBOX_BROWSER_IMAGE?.trim() || BROWSER_IMAGE;

const LIMITS = [
  "--runtime=runsc",
  "--cpus=1",
  "--memory=1536m",
  "--memory-swap=1536m",
  "--pids-limit=256",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--read-only",
  "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
  "--user=pwuser",
  "--label=techteam.sandbox=1",
  "--label=techteam.browser=1",
  // Built on the host from deploy/browser, never pulled: a registry image with that name isn't ours.
  "--pull=never",
];

// A base64 viewport PNG is well under this; the rest of the report is a few dozen KB at most.
const STDOUT_MAX = 12 * 1024 * 1024;
const STDERR_KEEP = 4_000;
const KILL_GRACE_MS = 15_000;
const INSPECT_TIMEOUT_MS = 30_000;

type CliResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/**
 * The docker CLI at SANDBOX_DOCKER_HOST, with stdout kept apart from stderr and a larger output cap than
 * docker.ts's helper (the screenshot travels on stdout). Same environment rule: only PATH, HOME and DOCKER_HOST.
 */
function dockerCli(args: string[], options: { input?: string; timeoutMs: number; name?: string }): Promise<CliResult> {
  const host = sandboxHost();
  if (!host) return Promise.reject(new Error("No sandbox host: set SANDBOX_DOCKER_HOST."));
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DOCKER_HOST: host },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > STDOUT_MAX) overflow = true;
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEEP);
    });

    let timedOut = false;
    let fallback: NodeJS.Timeout | undefined;
    const timer = setTimeout(
      () => {
        timedOut = true;
        // Killing the CLI wouldn't stop a remote container: kill it by name, then the CLI if it hangs on.
        if (options.name) void dockerCli(["kill", options.name], { timeoutMs: KILL_GRACE_MS }).catch(() => undefined);
        fallback = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      },
      Math.max(options.timeoutMs, 1)
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      resolve({ code, stdout: overflow ? "" : Buffer.concat(chunks).toString("utf8"), stderr, timedOut });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

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
    const run = await dockerCli(
      [
        "run",
        "--rm",
        "-i",
        `--name=${name}`,
        ...LIMITS,
        `--network=${target.network}`,
        // Docker's DNS doesn't answer under gVisor: give the browser the preview's address, and nothing else.
        `--add-host=${target.container}:${address}`,
        image(),
      ],
      { input: JSON.stringify(runnerInput(request, target.internalUrl)), timeoutMs: started + BROWSE_TIMEOUT_SECONDS * 1000 - Date.now(), name }
    );
    if (run.timedOut) return { kind: "timed_out", durationMs: Date.now() - started };
    const output = parseRunnerOutput(run.stdout);
    if (!output) {
      if (/Unable to find image|No such image/i.test(run.stderr)) {
        console.error(`[browser] ${image()} isn't on the sandbox host: build it from deploy/browser (deploy/setup.sh).`);
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
