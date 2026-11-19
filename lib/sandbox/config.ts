/**
 * Agent sandboxes: the vocabulary shared by server and client (Settings → Sandbox, the agent tools, the agent log).
 * Pure; lib/sandbox/docker.ts runs the commands.
 */

import type { AgentStage } from "@/lib/agent-run-config";

/** Stages that get the sandbox tools (with `tests.run`): the Developer's and the Tester's. */
export const SANDBOX_STAGES: readonly AgentStage[] = ["development", "testing"];

export const SANDBOX_COMMAND_KINDS = ["install", "test", "build"] as const;
export type SandboxCommandKind = (typeof SANDBOX_COMMAND_KINDS)[number];
/** Shell commands run at the repository root. Null: the repository has nothing to run for that step. */
export type SandboxCommands = Record<SandboxCommandKind, string | null>;

export const SANDBOX_COMMAND_LABEL: Record<SandboxCommandKind, string> = {
  install: "Install dependencies",
  test: "Run the tests",
  build: "Build",
};

export const SANDBOX_COMMAND_MAX = 300;
/** One tool call: preparing the checkout, installing (when the lockfile changed) and the command itself. */
export const SANDBOX_TIMEOUT_SECONDS = 300;
/** Characters of output an agent gets back: the end, where test runners and compilers print their failures. */
export const SANDBOX_OUTPUT_MAX = 12_000;

const NO_COMMANDS: SandboxCommands = { install: null, test: null, build: null };

// `npm init` writes this test script; it only ever fails.
const NPM_PLACEHOLDER_TEST = /no test specified/i;

/**
 * Commands for a Node repository, from its root package.json and the lockfiles at the root. Tests and builds go
 * through `npm`, which runs any package manager's scripts once node_modules exists.
 */
export function detectCommands(packageJson: string | null, rootFiles: readonly string[]): SandboxCommands {
  if (packageJson === null) return NO_COMMANDS;
  let scripts: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(packageJson);
    if (parsed && typeof parsed === "object" && "scripts" in parsed && parsed.scripts && typeof parsed.scripts === "object") {
      scripts = parsed.scripts as Record<string, unknown>;
    }
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
  return { install, test, build };
}

export function isSandboxCommands(value: unknown): value is SandboxCommands {
  if (!value || typeof value !== "object") return false;
  return SANDBOX_COMMAND_KINDS.every((kind) => {
    const command = (value as Record<string, unknown>)[kind];
    return command === null || typeof command === "string";
  });
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
