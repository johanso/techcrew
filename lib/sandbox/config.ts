/**
 * Agent sandboxes: the vocabulary shared by server and client (Settings → Sandbox, the agent tools, the agent log).
 * Pure; lib/sandbox/docker.ts runs the commands.
 */

import type { AgentStage } from "@/lib/agent-run-config";

/** Stages that get the sandbox tools (with `tests.run`): the Developer's and the Tester's. */
export const SANDBOX_STAGES: readonly AgentStage[] = ["development", "testing"];

export const SANDBOX_COMMAND_KINDS = ["install", "test", "build", "preview"] as const;
export type SandboxCommandKind = (typeof SANDBOX_COMMAND_KINDS)[number];
/**
 * Shell commands run at the repository root. Null: the repository has nothing to run for that step. `preview` builds
 * and serves the app on PREVIEW_PORT (it gets PORT and HOST) for a pull request's preview.
 */
export type SandboxCommands = Record<SandboxCommandKind, string | null>;
/** What workspaces.sandbox_commands holds: rows saved before previews have no `preview`. */
export type StoredSandboxCommands = Omit<SandboxCommands, "preview"> & { preview?: string | null };

export const SANDBOX_COMMAND_LABEL: Record<SandboxCommandKind, string> = {
  install: "Install dependencies",
  test: "Run the tests",
  build: "Build",
  preview: "Serve a preview",
};

export const SANDBOX_COMMAND_MAX = 300;
/** One tool call: preparing the checkout, installing (when the lockfile changed) and the command itself. */
export const SANDBOX_TIMEOUT_SECONDS = 300;
/** Characters of output an agent gets back: the end, where test runners and compilers print their failures. */
export const SANDBOX_OUTPUT_MAX = 12_000;

/**
 * The install step's bridge network (prepare containers: unpack + install, the only sandbox step with network):
 * internet, no traffic between containers, and a fixed subnet that deploy/setup.sh's DOCKER-USER rules keep off
 * private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved ranges, as for link captures.
 */
export const SANDBOX_NETWORK = "techteam-sandbox";
export const SANDBOX_SUBNET = "172.31.252.0/24";
/**
 * A small volume holding the install step's resolv.conf (public resolvers), mounted read-only over /etc/resolv.conf:
 * on a user-defined network Docker points containers at its embedded resolver (127.0.0.11), which doesn't answer
 * under gVisor, and `--dns` only changes that resolver's upstreams.
 */
export const SANDBOX_DNS_VOLUME = "techteam-sandbox-dns";
export const SANDBOX_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"] as const;

/** The resolv.conf the install step gets. */
export function sandboxResolvConf() {
  return `${SANDBOX_RESOLVERS.map((address) => `nameserver ${address}`).join("\n")}\noptions timeout:2 attempts:2\n`;
}

/** `docker network inspect --format` for bridgeNetworkProblem: internal flag, inter-container traffic, subnet. */
export const BRIDGE_INSPECT_FORMAT = `{{.Internal}} {{index .Options "com.docker.network.bridge.enable_icc"}} {{range .IPAM.Config}}{{.Subnet}}{{end}}`;

/**
 * Whether an inspected network (BRIDGE_INSPECT_FORMAT) has the shape the host firewall expects: not internal (it
 * needs a route out), icc off and exactly `subnet` (the DOCKER-USER rules match it). Null when it does, else what
 * differs, for the server log.
 */
export function bridgeNetworkProblem(inspected: string, subnet: string): string | null {
  // A missing option prints as "<no value>" (two words): the subnet is the last field, icc whatever sits between.
  const fields = inspected.trim().split(/\s+/);
  const internal = fields[0] ?? "";
  const actual = fields.length > 2 ? fields[fields.length - 1] : "";
  const icc = fields.slice(1, fields.length > 2 ? -1 : undefined).join(" ");
  if (internal === "false" && icc === "false" && actual === subnet) return null;
  return `internal=${internal} icc=${icc} subnet=${actual}; expected internal=false icc=false subnet=${subnet}`;
}

const NO_COMMANDS: SandboxCommands = { install: null, test: null, build: null, preview: null };

// `npm init` writes this test script; it only ever fails.
const NPM_PLACEHOLDER_TEST = /no test specified/i;

const recordOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/**
 * How to serve a preview on PREVIEW_PORT, from what the package depends on: Next.js (`next start`) or Vite
 * (`vite preview`) after the build, else the start script (it gets PORT and HOST), built first when there's a build.
 * Binaries come from node_modules (`npx --no` never downloads): a preview has no network.
 */
function detectPreview(scripts: Record<string, unknown>, dependencies: Record<string, unknown>) {
  const build = typeof scripts.build === "string";
  if ("next" in dependencies) return `${build ? "npm run build" : "npx --no next build"} && npx --no next start -H 0.0.0.0 -p ${PREVIEW_PORT}`;
  if ("vite" in dependencies) {
    return `${build ? "npm run build" : "npx --no vite build"} && npx --no vite preview --host 0.0.0.0 --port ${PREVIEW_PORT} --strictPort`;
  }
  if (typeof scripts.start === "string") return build ? "npm run build && npm start" : "npm start";
  return null;
}

/**
 * Commands for a Node repository, from its root package.json and the lockfiles at the root. Tests and builds go
 * through `npm`, which runs any package manager's scripts once node_modules exists.
 */
export function detectCommands(packageJson: string | null, rootFiles: readonly string[]): SandboxCommands {
  if (packageJson === null) return NO_COMMANDS;
  let scripts: Record<string, unknown> = {};
  let dependencies: Record<string, unknown> = {};
  try {
    const parsed = recordOf(JSON.parse(packageJson));
    scripts = recordOf(parsed.scripts);
    dependencies = { ...recordOf(parsed.devDependencies), ...recordOf(parsed.dependencies) };
  } catch {
    // Unparseable package.json: npm would fail the same way, so still offer the install.
  }
  const files = new Set(rootFiles);
  const install = files.has("package-lock.json")
    ? "npm ci"
    : files.has("pnpm-lock.yaml")
      ? "npx --yes pnpm install --frozen-lockfile"
      : files.has("yarn.lock")
        ? "npx --yes yarn install --frozen-lockfile"
        : "npm install";
  const test = typeof scripts.test === "string" && !NPM_PLACEHOLDER_TEST.test(scripts.test) ? "npm test" : null;
  const build = typeof scripts.build === "string" ? "npm run build" : null;
  return { install, test, build, preview: detectPreview(scripts, dependencies) };
}

/** Saved commands, with `preview` null on rows saved before previews. Null when nothing valid is saved. */
export function sandboxCommandsOf(value: unknown): SandboxCommands | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const commands: SandboxCommands = { ...NO_COMMANDS };
  for (const kind of SANDBOX_COMMAND_KINDS) {
    const command = saved[kind] ?? null;
    if (command !== null && typeof command !== "string") return null;
    commands[kind] = command;
  }
  return commands;
}

export function isSandboxCommands(value: unknown): value is SandboxCommands {
  return sandboxCommandsOf(value) !== null;
}

/** One command from a form: trimmed, a single line, within the limit. Empty means "nothing to run". */
export function parseSandboxCommand(raw: unknown): { ok: true; command: string | null } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: true, command: null };
  if (/[\r\n\0]/.test(text)) return { ok: false, error: "Use a single line. Join steps with &&." };
  if (text.length > SANDBOX_COMMAND_MAX) return { ok: false, error: `Keep it under ${SANDBOX_COMMAND_MAX} characters.` };
  return { ok: true, command: text };
}

/** What a sandbox call did. `failedStep` says where it stopped: preparing the checkout, installing or the command. */
export type SandboxRun = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  failedStep: "prepare" | "install" | "command" | null;
  durationMs: number;
  /** The end of what the steps printed, ANSI codes removed. */
  output: string;
};

/** The port a preview's server listens on inside its container (the preview command gets PORT and HOST). */
export const PREVIEW_PORT = 4173;

/**
 * Where a run's preview lives on the sandbox host. The container and its internal network share one name: the
 * browser joins that network and opens `internalUrl`; Caddy joins it too and serves the public host.
 */
export function previewTarget(runId: number) {
  const name = `techteam-preview-run-${runId}`;
  return { container: name, network: name, internalUrl: `http://${name}:${PREVIEW_PORT}` };
}

/** A preview is stopped this long after it started (or restarted on a rework round). */
export const PREVIEW_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** From launch until the server answers: installing, building and starting. Past it the preview has failed. */
export const PREVIEW_READY_TIMEOUT_MS = 8 * 60 * 1000;

export const PREVIEW_STATUSES = ["starting", "running", "failed", "stopped"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

/**
 * agent_runs.preview: the run's preview, one per run. A rework round restarts it on the new commit under the same
 * host; a new run on the same pull request gets a new host and stops the old one.
 */
export type RunPreview = {
  status: PreviewStatus;
  /** The public host, `pr-<n>-<6 random [a-z0-9]>.<SANDBOX_PREVIEW_DOMAIN>`: unguessable, never reused by another run. */
  host: string;
  prNumber: number;
  /** The development round and the commit it serves. */
  round: number;
  sha: string;
  startedAt: string;
  readyAt: string | null;
  endedAt: string | null;
  /** Why it failed or stopped, in the app's words (never the repository's output). */
  reason: string | null;
};

const PREVIEW_SLUG = /^[a-z0-9]{6}$/;
const DOMAIN = /^(?=.{1,200}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isPreviewDomain(value: string) {
  return DOMAIN.test(value);
}

/** `pr-12-k3x9ab.preview.example.com`. The slug is 6 random [a-z0-9] (lib/sandbox/preview.ts draws it). */
export function previewHost(prNumber: number, slug: string, domain: string) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error("A preview needs a pull request number.");
  if (!PREVIEW_SLUG.test(slug)) throw new Error("A preview slug is 6 characters of [a-z0-9].");
  if (!isPreviewDomain(domain)) throw new Error("SANDBOX_PREVIEW_DOMAIN isn't a domain name.");
  return `pr-${prNumber}-${slug}.${domain}`;
}

export const previewUrl = (preview: Pick<RunPreview, "host">) => `https://${preview.host}`;

/** A preview the app still holds resources for (container, network, volume). */
export const isPreviewLive = (preview: Pick<RunPreview, "status">) => preview.status === "starting" || preview.status === "running";

/** Live past PREVIEW_MAX_AGE_MS: the sweep stops it. */
export function isPreviewExpired(preview: Pick<RunPreview, "status" | "startedAt">, now = Date.now()) {
  return isPreviewLive(preview) && now - new Date(preview.startedAt).getTime() > PREVIEW_MAX_AGE_MS;
}

export function parseRunPreview(value: unknown): RunPreview | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const optionalText = (v: unknown) => v === null || typeof v === "string";
  return (PREVIEW_STATUSES as readonly unknown[]).includes(p.status) &&
    typeof p.host === "string" &&
    typeof p.prNumber === "number" &&
    typeof p.round === "number" &&
    typeof p.sha === "string" &&
    typeof p.startedAt === "string" &&
    optionalText(p.readyAt) &&
    optionalText(p.endedAt) &&
    optionalText(p.reason)
    ? (p as RunPreview)
    : null;
}

/** The agent log's line for a preview: where it runs and how long it took, or why it failed. */
export function previewLogSummary(preview: RunPreview) {
  if (preview.status === "running") {
    const took = preview.readyAt ? ` in ${formatDuration(new Date(preview.readyAt).getTime() - new Date(preview.startedAt).getTime())}` : "";
    return `Running at ${previewUrl(preview)} (ready${took}, commit ${preview.sha.slice(0, 7)})`;
  }
  if (preview.status === "starting") return `Starting on commit ${preview.sha.slice(0, 7)}`;
  return `${preview.status === "failed" ? "Failed" : "Stopped"}: ${preview.reason ?? "no reason given"}`;
}

export function formatDuration(ms: number) {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * The report an agent gets. The first line starts with Passed, Failed or Timed out (toolStep logs only that line:
 * the output is the repository's, so it never reaches the database).
 */
export function sandboxReport(run: SandboxRun) {
  const took = formatDuration(run.durationMs);
  const step = run.failedStep === "install" ? " while installing dependencies" : run.failedStep === "prepare" ? " while preparing the checkout" : "";
  const headline = run.timedOut
    ? `Timed out${step} after ${took}: ${run.command}`
    : run.failedStep
      ? `Failed${step}: ${run.command} (exit ${run.exitCode ?? "?"}, ${took})`
      : `Passed: ${run.command} (exit 0, ${took})`;
  return run.output ? `${headline}\n\nOutput (the end):\n${run.output}` : headline;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * The end of a command's output, readable: color codes removed, progress bars collapsed to their last state (the
 * text after the last carriage return on each line), cut to `max` characters at a line start.
 */
export function outputTail(raw: string, max = SANDBOX_OUTPUT_MAX) {
  const text = raw
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).pop() ?? "")
    .join("\n")
    .trimEnd();
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const start = cut.indexOf("\n") + 1;
  return `… [${text.length - max + start} earlier characters]\n${cut.slice(start)}`;
}
