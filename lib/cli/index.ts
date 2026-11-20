import "server-only";

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { cliSettings, db } from "@/db";
import type { AgentModelId } from "@/lib/agent-config";
import {
  cliAgentsAllowed,
  isPlanLimitPolicy,
  parseCliAuth,
  type CliAuth,
  type CliKind,
  type CliMachineState,
  type ConfirmedAccount,
  type PlanLimitPolicy,
} from "@/lib/cli-agents-config";

// Taken from process.getBuiltinModule instead of imported: Turbopack traces `fs` and `child_process` calls, and paths
// it can't resolve (the home and temp folders) become references to every file in the project, so the dev server's
// own log file made the client bundles "change" in a loop (endless reloads with "HMR hash mismatch").
const { spawn } = process.getBuiltinModule("node:child_process") as typeof import("node:child_process");
const { access, constants, mkdir, readdir, readFile, rm, writeFile } = process.getBuiltinModule("node:fs/promises") as typeof import("node:fs/promises");

/**
 * Local CLIs as agent runtimes, the server side (docs/cli-agents-plan.md): where TechTeam's own CLI login lives on
 * this computer, finding the binary, its sign-in, the owner's per-computer settings and what this computer remembers
 * about the plan. Nothing here runs unless TechTeam runs locally (cliAgentsAvailable).
 *
 * TechTeam never touches the owner's normal CLI login: every CLI call runs with CLAUDE_CONFIG_DIR set to TechTeam's
 * own config home, outside the project (Turbopack watches the project), and with an allowlisted environment (no API
 * keys, no database URL).
 */

/** CLI agents may run on this computer: a local checkout, not a deploy, and not switched off (AGENTS_LOCAL_CLI=false). */
export const cliAgentsAvailable = () => cliAgentsAllowed(process.env);

/** TechTeam's CLI home: ~/.techteam/cli (%USERPROFILE%\.techteam\cli on Windows), or TECHTEAM_CLI_HOME. */
export function cliHome() {
  return process.env.TECHTEAM_CLI_HOME || path.join(os.homedir(), ".techteam", "cli");
}

/** Claude Code's config home for TechTeam: its own login, settings, sessions; none of the owner's MCP servers or hooks. */
export const claudeConfigDir = () => path.join(cliHome(), "claude");

// ── This computer ──────────────────────────────────────────────────────────────

type LocalState = {
  machineId: string;
  /** Per CLI: models the plan refused, and until when its usage window ran out. */
  clis: Partial<Record<CliKind, { unusable: string[]; limitedUntil: string | null }>>;
};

const statePath = () => path.join(cliHome(), "state.json");

async function readLocalState(): Promise<LocalState> {
  try {
    const raw = JSON.parse(await readFile(statePath(), "utf8")) as Partial<LocalState>;
    if (typeof raw.machineId === "string" && raw.machineId) return { machineId: raw.machineId, clis: raw.clis ?? {} };
  } catch {
    // First use on this computer, or an unreadable file: start a new identity.
  }
  const state: LocalState = { machineId: randomUUID(), clis: {} };
  await writeLocalState(state);
  return state;
}

async function writeLocalState(state: LocalState) {
  await mkdir(cliHome(), { recursive: true, mode: 0o700 });
  await writeFile(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function updateCliState(kind: CliKind, update: (current: { unusable: string[]; limitedUntil: string | null }) => { unusable: string[]; limitedUntil: string | null }) {
  const state = await readLocalState();
  state.clis[kind] = update(state.clis[kind] ?? { unusable: [], limitedUntil: null });
  await writeLocalState(state);
}

/** This computer's id: the owner's per-computer settings are keyed by it (the database is shared by both computers). */
export async function machineId() {
  return (await readLocalState()).machineId;
}

/** The plan refused this model: route it to the API key on this computer from now on. */
export const rememberModelUnusable = (kind: CliKind, model: AgentModelId) =>
  updateCliState(kind, (current) => ({ ...current, unusable: [...new Set([...current.unusable, model])] }));

/** The plan's usage window ran out until `until`: later stages on this computer take the API key (or wait) until then. */
export const rememberPlanLimited = (kind: CliKind, until: string) => updateCliState(kind, (current) => ({ ...current, limitedUntil: until }));

// ── Child processes ────────────────────────────────────────────────────────────

// What a CLI needs from the parent environment, and nothing else: never API keys, the database URL or tokens.
const CHILD_ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT", "ComSpec"];

/** An allowlisted environment for a CLI child process, plus `extra`. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of CHILD_ENV_KEYS) if (process.env[key]) env[key] = process.env[key];
  // No auto-update mid-run, and no telemetry or other traffic the agent doesn't need.
  return { ...env, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ...extra };
}

export type CliResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Runs a CLI to completion with an argument array (never a shell string) and a deadline. Output is capped. */
export function runCliProcess(binary: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number; cwd?: string; input?: string }): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { env: options.env, cwd: options.cwd ?? os.tmpdir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const cap = 200_000;
    child.stdout.on("data", (chunk: Buffer) => (stdout = (stdout + chunk.toString("utf8")).slice(-cap)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-cap)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(options.input ?? "");
  });
}

// ── Claude Code ────────────────────────────────────────────────────────────────

/** Where Claude Code's native installer and Homebrew put it, per OS; CLAUDE_CLI_PATH first. */
function claudeCandidates() {
  const home = os.homedir();
  const explicit = process.env.CLAUDE_CLI_PATH ? [process.env.CLAUDE_CLI_PATH] : [];
  if (process.platform === "win32") {
    const profile = process.env.USERPROFILE || home;
    return [...explicit, path.join(profile, ".local", "bin", "claude.exe"), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm", "claude.cmd")] : [])];
  }
  return [...explicit, path.join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", path.join(home, ".claude", "local", "claude")];
}

async function findClaudeBinary() {
  for (const candidate of claudeCandidates()) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next place.
    }
  }
  return null;
}

/** Claude Code's env for TechTeam: its own config home, so the owner's login, MCP servers, hooks and memory stay out. */
export const claudeEnv = (extra: Record<string, string> = {}) => childEnv({ CLAUDE_CONFIG_DIR: claudeConfigDir(), ...extra });

export type ClaudeDetection = {
  /** CLI agents are possible on this computer at all (local checkout, not switched off). */
  available: boolean;
  binary: string | null;
  version: string | null;
  /** Why the binary can't run stages (an npm shim on Windows), or null. */
  problem: string | null;
  auth: CliAuth | null;
  checkedAt: string;
};

let cached: { at: number; value: ClaudeDetection } | null = null;
const DETECT_TTL_MS = 60_000;

/** Finds Claude Code and reads its sign-in under TechTeam's config home. Cached a minute; `fresh` re-checks (Check again). */
export async function detectClaude({ fresh = false } = {}): Promise<ClaudeDetection> {
  if (!fresh && cached && Date.now() - cached.at < DETECT_TTL_MS) return cached.value;
  const value = await detectClaudeNow();
  cached = { at: Date.now(), value };
  return value;
}

async function detectClaudeNow(): Promise<ClaudeDetection> {
  const checkedAt = new Date().toISOString();
  const none = { binary: null, version: null, problem: null, auth: null, checkedAt };
  if (!cliAgentsAvailable()) return { available: false, ...none };
  const binary = await findClaudeBinary();
  if (!binary) return { available: true, ...none };
  // An npm shim needs a shell on Windows, where quoting the agent's arguments safely isn't possible: ask for the
  // native build instead of running stages through cmd.exe.
  if (binary.toLowerCase().endsWith(".cmd")) {
    return { available: true, ...none, binary, problem: "Claude Code is installed through npm. Install the native build (the command below) so TechTeam can run it without a shell." };
  }
  const env = claudeEnv();
  const [version, status] = await Promise.all([
    runCliProcess(binary, ["--version"], { env, timeoutMs: 15_000 }),
    runCliProcess(binary, ["auth", "status", "--json"], { env, timeoutMs: 15_000 }),
  ]);
  return {
    available: true,
    binary,
    version: version.stdout.trim().split(/\s+/)[0] || null,
    problem: version.code === 0 ? null : `Claude Code didn't start: ${(version.stderr || version.stdout).trim().split("\n")[0] ?? "unknown error"}`,
    auth: status.code === 0 || status.stdout.trim().startsWith("{") ? parseCliAuth(status.stdout) : null,
    checkedAt,
  };
}

/** Forgets the cached detection (after signing in or out). */
export const forgetClaudeDetection = () => {
  cached = null;
};

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/**
 * Starts `claude auth login` under TechTeam's config home: it opens the browser on this computer for the owner to sign
 * in with their personal account. Detached, with a deadline; Settings polls the status (Check again).
 */
export async function startClaudeSignIn(): Promise<{ ok: true } | { ok: false; error: string }> {
  const detection = await detectClaude({ fresh: true });
  if (!detection.available) return { ok: false, error: "Plans run only when TechTeam runs on your computer." };
  if (!detection.binary || detection.problem) return { ok: false, error: detection.problem ?? "Install Claude Code first." };
  await mkdir(claudeConfigDir(), { recursive: true, mode: 0o700 });
  const child = spawn(detection.binary, ["auth", "login", "--claudeai"], { env: claudeEnv(), cwd: os.tmpdir(), stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", (error) => console.error("[cli] claude auth login failed to start", error.message));
  const timer = setTimeout(() => child.kill(), SIGN_IN_TIMEOUT_MS);
  child.on("close", () => {
    clearTimeout(timer);
    forgetClaudeDetection();
  });
  child.unref();
  return { ok: true };
}

/** Signs TechTeam's Claude Code out (only TechTeam's config home; the owner's normal login stays). */
export async function signOutClaude(): Promise<{ ok: true } | { ok: false; error: string }> {
  const detection = await detectClaude({ fresh: true });
  if (!detection.binary || detection.problem) return { ok: false, error: detection.problem ?? "Claude Code isn't installed." };
  const result = await runCliProcess(detection.binary, ["auth", "logout"], { env: claudeEnv(), timeoutMs: 20_000 });
  forgetClaudeDetection();
  return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || result.stdout).trim().split("\n")[0] || "Sign-out failed." };
}

// ── The owner's settings on this computer ──────────────────────────────────────

export type CliSettingsView = { enabled: boolean; onLimit: PlanLimitPolicy | null; confirmed: ConfirmedAccount | null };

/** The owner's settings for this CLI on this computer (defaults when never saved). */
export async function getCliSettings(userId: number, kind: CliKind): Promise<CliSettingsView> {
  const machine = await machineId();
  const [row] = await db
    .select()
    .from(cliSettings)
    .where(and(eq(cliSettings.userId, userId), eq(cliSettings.machineId, machine), eq(cliSettings.cli, kind)));
  return {
    enabled: row?.enabled ?? false,
    onLimit: isPlanLimitPolicy(row?.onLimit) ? row.onLimit : null,
    confirmed: row?.confirmedEmail ? { email: row.confirmedEmail, orgName: row.confirmedOrg } : null,
  };
}

/** Saves part of the owner's settings for this CLI on this computer. */
export async function saveCliSettings(userId: number, kind: CliKind, patch: { enabled?: boolean; onLimit?: PlanLimitPolicy; confirmed?: ConfirmedAccount | null }) {
  const machine = await machineId();
  const values = {
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.onLimit === undefined ? {} : { onLimit: patch.onLimit }),
    ...(patch.confirmed === undefined ? {} : { confirmedEmail: patch.confirmed?.email ?? null, confirmedOrg: patch.confirmed?.orgName ?? null }),
    updatedAt: new Date(),
  };
  await db
    .insert(cliSettings)
    .values({ userId, machineId: machine, cli: kind, ...values })
    .onConflictDoUpdate({ target: [cliSettings.userId, cliSettings.machineId, cliSettings.cli], set: values });
}

/**
 * What route resolution needs to know about Claude Code on this computer for `userId` (the workspace owner), or null
 * when CLI agents aren't possible here. Read at Run and again at the start of every stage.
 */
export async function claudeMachineState(userId: number): Promise<(CliMachineState & { onLimit: PlanLimitPolicy | null }) | null> {
  if (!cliAgentsAvailable()) return null;
  const [detection, settings, local] = await Promise.all([detectClaude(), getCliSettings(userId, "claude"), readLocalState()]);
  const remembered = local.clis.claude ?? { unusable: [], limitedUntil: null };
  return {
    installed: Boolean(detection.binary && !detection.problem),
    enabled: settings.enabled,
    auth: detection.auth,
    confirmed: settings.confirmed,
    unusable: remembered.unusable,
    limitedUntil: remembered.limitedUntil,
    onLimit: settings.onLimit,
  };
}

// ── Per-run working folders ────────────────────────────────────────────────────

/** An empty working folder for a run's CLI sessions (outside the project, so Turbopack never watches it). */
export async function runWorkdir(runId: number) {
  const dir = path.join(os.tmpdir(), "techteam", `run-${runId}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Whether Claude Code already has this session under TechTeam's config home: a retried first chunk must resume the
 * session it started instead of creating it again (`--session-id` refuses an id in use).
 */
export async function claudeSessionExists(sessionId: string) {
  const projects = path.join(claudeConfigDir(), "projects");
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return false;
  }
  for (const dir of dirs) {
    try {
      await access(path.join(projects, dir, `${sessionId}.jsonl`));
      return true;
    } catch {
      // Not in this project folder.
    }
  }
  return false;
}

/** Removes a run's working folder (finishRun), best effort. */
export async function removeRunWorkdir(runId: number) {
  await rm(path.join(os.tmpdir(), "techteam", `run-${runId}`), { recursive: true, force: true }).catch(() => undefined);
}
