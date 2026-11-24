// The checks of `npm run doctor`. Each one reads the machine only through `probes` (see probes.mjs), so tests inject
// fakes. A check returns a result with a status and one line of detail; problems and warnings carry a one-line fix.
// Nothing here puts a value from the environment or a file into a result: key names, booleans and versions only.
import { createHash } from "node:crypto";
import path from "node:path";

import { claudeCandidates, claudeChildEnv, claudeConfigDir, isNpmShim, parseAuthSummary } from "./claude.mjs";
import { obsoleteKeysSet } from "./env-hygiene.mjs";
import { pidFileState, pgDataDir, resolveDataDir, resolvePort, secretPath, embeddedApplies, embeddedUrl, PG_HOST } from "../local-db-config.mjs";
import { resolveAppPort, resolveInngestPort } from "../local-stack-config.mjs";

/** Same value as DEFAULT_GITHUB_CLIENT_ID in lib/github-client-id.ts (a unit test keeps them equal). */
export const DEFAULT_GITHUB_CLIENT_ID = "Ov23liY9eiTmtnf5u8uu";

export const MIN_NODE = { major: 22, minor: 18 };
const LOW_DISK_BYTES = 2 * 1024 ** 3;

/**
 * @typedef {"ok" | "info" | "warn" | "fail"} Status
 * @typedef {{ id: string, label: string, status: Status, detail: string, hint?: string }} CheckResult
 * @typedef {{ code: number | null, stdout: string, stderr: string }} RunResult
 * @typedef {object} Probes
 * @property {Record<string, string | undefined>} env
 * @property {string} platform
 * @property {string} home
 * @property {string} nodeVersion
 * @property {string} root the repository folder
 * @property {(file: string) => boolean} exists
 * @property {(file: string) => string | null} readText null when missing
 * @property {(dir: string) => boolean} canWrite the folder, or its nearest existing parent, accepts files
 * @property {(dir: string) => number | null} freeBytes free space of the folder's disk
 * @property {(command: string, args: string[], options?: { env?: Record<string, string>, shell?: boolean }) => Promise<RunResult>} run
 * @property {(port: number) => Promise<boolean>} portAnswers a TCP connect to 127.0.0.1 succeeds
 * @property {(port: number) => Promise<string | null>} portOwner the program listening there, when cheaply known
 * @property {(url: string) => Promise<unknown>} getJson parsed JSON of a GET, null on any failure
 * @property {(url: string) => Promise<boolean>} reachable an HTTPS HEAD answers within 5 s
 * @property {(pid: number) => boolean} pidAlive
 * @property {(url: string) => Promise<{ reachable: boolean, applied: number | null }>} queryDatabase `select 1`, then migrations applied (null: none table)
 * @property {string[] | null} envFileKeys names declared in .env / .env.local, null when neither exists
 */

/** @param {string} id @param {string} label @param {Status} status @param {string} detail @param {string} [hint] @returns {CheckResult} */
const result = (id, label, status, detail, hint) => (hint ? { id, label, status, detail, hint } : { id, label, status, detail });

/** @param {string} version "22.18.0" @returns {[number, number]} */
function majorMinor(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
  return [major || 0, minor || 0];
}

/** `value` is a base64 text of exactly 32 bytes. @param {string} value */
export const isValidKey = (value) => Buffer.from(value.trim(), "base64").length === 32;

const sha = (/** @type {string} */ value) => createHash("sha256").update(Buffer.from(value.trim(), "base64")).digest("hex");

/** @param {Probes} p */
export async function checkNode(p) {
  const [major, minor] = majorMinor(p.nodeVersion);
  const need = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  const label = "Node.js";
  if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
    return [result("node", label, "fail", `${p.nodeVersion.replace(/^v/, "")} is too old (need ${need} or newer)`, `Install Node.js ${MIN_NODE.major} LTS or newer from nodejs.org.`)];
  }
  const npm = await p.run("npm", ["--version"], { shell: true });
  const results = [result("node", label, "ok", `${p.nodeVersion.replace(/^v/, "")}`)];
  results.push(
    npm.code === 0
      ? result("npm", "npm", "ok", npm.stdout.trim().split(/\s+/)[0] ?? "installed")
      : result("npm", "npm", "fail", "not found", "npm comes with Node.js: reinstall it from nodejs.org."),
  );
  return results;
}

/** @param {Probes} p */
export async function checkTools(p) {
  const git = await p.run("git", ["--version"], { shell: true });
  const tar = await p.run("tar", ["--version"], { shell: true });
  return [
    git.code === 0
      ? result("git", "git", "ok", git.stdout.trim().replace(/^git version\s+/, ""))
      : result("git", "git", "fail", "not found", "Install git (git-scm.com): agents work on your repository through it."),
    tar.code === 0
      ? result("tar", "tar", "ok", "found (backup and restore)")
      : result("tar", "tar", "fail", "not found", "Backup and restore need the system tar (Windows 10+, macOS and Linux include it)."),
  ];
}

/** @param {Probes} p */
export function checkDataDir(p) {
  const dir = resolveDataDir(p.env, p.home);
  const label = "Data folder";
  if (!p.canWrite(dir)) {
    return [result("data-dir", label, "fail", `${dir} is not writable`, "Fix its permissions, or set TECHTEAM_DATA_DIR to a folder you can write to.")];
  }
  const free = p.freeBytes(dir);
  const where = p.exists(dir) ? "exists" : "will be created at first start";
  if (free !== null && free < LOW_DISK_BYTES) {
    return [result("data-dir", label, "warn", `${dir} (${where}), only ${(free / 1024 ** 3).toFixed(1)} GB free`, "Free some disk space: the database and agent work need room.")];
  }
  return [result("data-dir", label, "ok", `${dir} (${where})`)];
}

/**
 * One port: free, TechTeam's own, or taken by something else.
 * @param {Probes} p
 * @param {{ id: string, label: string, port: number, ownedByTechTeam: () => Promise<boolean>, setting: string }} port
 */
async function checkPort(p, { id, label, port, ownedByTechTeam, setting }) {
  if (!(await p.portAnswers(port))) return result(id, label, "ok", `port ${port} is free`);
  if (await ownedByTechTeam()) return result(id, label, "info", `port ${port}: TechTeam is running`);
  const owner = await p.portOwner(port);
  return result(id, label, "warn", `port ${port} is in use${owner ? ` by ${owner}` : ""}`, `Stop that program, or set ${setting} to another port.`);
}

/** @param {Probes} p */
export async function checkPorts(p) {
  const dataDir = resolveDataDir(p.env, p.home);
  const appPort = resolveAppPort(p.env);
  const inngestPort = resolveInngestPort(p.env);
  const dbPort = resolvePort(p.env);
  const pidText = p.readText(path.join(pgDataDir(dataDir), "postmaster.pid"));
  return [
    await checkPort(p, {
      id: "port-app",
      label: "App port",
      port: appPort,
      setting: "TECHTEAM_PORT",
      ownedByTechTeam: async () => {
        const body = await p.getJson(`http://127.0.0.1:${appPort}/api/inngest`);
        return typeof body === "object" && body !== null && "function_count" in body;
      },
    }),
    await checkPort(p, {
      id: "port-inngest",
      label: "Inngest port",
      port: inngestPort,
      setting: "TECHTEAM_INNGEST_PORT",
      ownedByTechTeam: async () => {
        const body = await p.getJson(`http://127.0.0.1:${inngestPort}/dev`);
        return typeof body === "object" && body !== null && "version" in body;
      },
    }),
    await checkPort(p, {
      id: "port-database",
      label: "Database port",
      port: dbPort,
      setting: "TECHTEAM_PG_PORT",
      ownedByTechTeam: async () => pidFileState(pidText, p.pidAlive) === "running",
    }),
  ];
}

/** Applied migrations against the journal's, as a result. @param {number | null} applied @param {number} expected */
function migrationsResult(applied, expected) {
  const label = "Migrations";
  if (applied === null) return result("migrations", label, "warn", `none applied (${expected} expected)`, "Run npm run db:migrate (the embedded database migrates itself on start).");
  if (applied < expected) return result("migrations", label, "warn", `${applied} of ${expected} applied`, "Run npm run db:migrate (or restart: the embedded database migrates itself).");
  if (applied > expected) return result("migrations", label, "info", `${applied} applied, this checkout knows ${expected} (the database is from a newer version)`);
  return result("migrations", label, "ok", `${applied} of ${expected} applied`);
}

/** The number of migrations in the journal, or null when it can't be read. @param {Probes} p */
function journalCount(p) {
  const text = p.readText(path.join(p.root, "drizzle", "meta", "_journal.json"));
  if (text === null) return null;
  try {
    const journal = JSON.parse(text);
    return Array.isArray(journal?.entries) ? journal.entries.length : null;
  } catch {
    return null;
  }
}

/** @param {Probes} p */
export async function checkDatabase(p) {
  const label = "Database";
  const expected = journalCount(p);
  if (!embeddedApplies(p.env)) {
    const probe = await p.queryDatabase(/** @type {string} */ (p.env.DATABASE_URL));
    if (!probe.reachable) return [result("database", label, "fail", "DATABASE_URL is set but the database doesn't answer", "Check the address and that the server is running (the value is not shown here).")];
    const rows = [result("database", label, "ok", "your own database (DATABASE_URL) answers")];
    if (expected !== null) rows.push(migrationsResult(probe.applied, expected));
    return rows;
  }
  const dataDir = resolveDataDir(p.env, p.home);
  const cluster = pgDataDir(dataDir);
  if (!p.exists(path.join(cluster, "PG_VERSION"))) {
    return [result("database", label, "info", "not created yet: the first npm run dev or start:local creates it")];
  }
  const pidText = p.readText(path.join(cluster, "postmaster.pid"));
  const port = resolvePort(p.env);
  const running = pidFileState(pidText, p.pidAlive) === "running" && (await p.portAnswers(port));
  if (!running) return [result("database", label, "info", "embedded database exists, not running (it starts with npm run dev or start:local)")];
  const secret = p.readText(secretPath(dataDir))?.trim() || null;
  const probe = secret ? await p.queryDatabase(embeddedUrl(port, secret)) : { reachable: false, applied: null };
  if (!probe.reachable) {
    return [result("database", label, "warn", `something answers on ${PG_HOST}:${port} but a read-only test failed`, "Stop it and start TechTeam again; check postgres.secret in the data folder.")];
  }
  const rows = [result("database", label, "ok", "embedded database is running and answers")];
  if (expected !== null) rows.push(migrationsResult(probe.applied, expected));
  return rows;
}

/** @param {Probes} p */
export function checkAppUrl(p) {
  const label = "App address";
  const raw = p.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    return [result("app-url", label, "warn", "NEXT_PUBLIC_APP_URL is not set", "Set NEXT_PUBLIC_APP_URL=http://localhost:3000 in .env: agents on your Claude plan need a local address.")];
  }
  try {
    const host = new URL(raw).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return [result("app-url", label, "ok", `${host} (local)`)];
    return [result("app-url", label, "warn", `points at ${host}, not this computer`, "Agents on a Claude plan only run when the address is localhost or 127.0.0.1.")];
  } catch {
    return [result("app-url", label, "warn", "NEXT_PUBLIC_APP_URL is not a valid address", "Use a full address such as http://localhost:3000.")];
  }
}

/** @param {Probes} p */
export function checkSecrets(p) {
  const label = "Encryption key";
  const dataDir = resolveDataDir(p.env, p.home);
  const fromEnv = p.env.TOKEN_ENCRYPTION_KEY?.trim() || null;
  const fromFile = p.readText(path.join(dataDir, "encryption.key"))?.trim() || null;
  if (fromEnv && !isValidKey(fromEnv)) {
    return [result("secrets", label, "fail", "TOKEN_ENCRYPTION_KEY is not 32 bytes of base64", "Generate one with: openssl rand -base64 32 (or remove the variable to use the generated key file).")];
  }
  if (fromEnv && fromFile) {
    if (!isValidKey(fromFile)) return [result("secrets", label, "warn", "TOKEN_ENCRYPTION_KEY is in use; encryption.key in the data folder is not a valid key", "Remove or fix that file.")];
    if (sha(fromEnv) !== sha(fromFile)) {
      return [result("secrets", label, "warn", "TOKEN_ENCRYPTION_KEY differs from encryption.key in the data folder", "Secrets saved with the other key can't be read: keep using one of them, or enter your keys again in Settings.")];
    }
    return [result("secrets", label, "ok", "TOKEN_ENCRYPTION_KEY (same as encryption.key)")];
  }
  if (fromEnv) return [result("secrets", label, "ok", "from TOKEN_ENCRYPTION_KEY")];
  if (fromFile) {
    return isValidKey(fromFile)
      ? [result("secrets", label, "ok", "from encryption.key in the data folder")]
      : [result("secrets", label, "fail", "encryption.key in the data folder is not a valid key", "Remove the file to start over (saved keys and tokens must then be entered again).")];
  }
  return [result("secrets", label, "info", "none yet: generated at first use in the data folder")];
}

/** @param {Probes} p */
export async function checkGithub(p) {
  const fromEnv = p.env.GITHUB_CLIENT_ID?.trim();
  const rows = [result("github-client", "GitHub sign-in", "ok", fromEnv && fromEnv !== DEFAULT_GITHUB_CLIENT_ID ? "using your own OAuth App" : "using the project's OAuth App")];
  rows.push(
    (await p.reachable("https://github.com"))
      ? result("github-net", "github.com", "ok", "reachable")
      : result("github-net", "github.com", "warn", "not reachable", "Check your internet connection or proxy: signing in and agents need github.com."),
  );
  return rows;
}

/** @param {Probes} p */
export async function checkClaude(p) {
  const label = "Claude Code";
  const candidates = claudeCandidates({ platform: p.platform, home: p.home, env: p.env });
  const binary = candidates.find((candidate) => p.exists(candidate));
  if (!binary) {
    return [result("claude", label, "info", "not installed (optional: your AI keys work without it)", "To run agents on a Claude plan, install Claude Code from claude.com/claude-code.")];
  }
  if (isNpmShim(binary)) {
    return [result("claude", label, "warn", "installed through npm (claude.cmd)", "Install the native build of Claude Code: TechTeam can't run the npm one without a shell.")];
  }
  const env = claudeChildEnv(p.env, claudeConfigDir(p.env, p.home));
  const version = await p.run(binary, ["--version"], { env });
  if (version.code !== 0) return [result("claude", label, "warn", "found but it doesn't start", "Reinstall Claude Code, or set CLAUDE_CLI_PATH to a working binary.")];
  const rows = [result("claude", label, "ok", `${version.stdout.trim().split(/\s+/)[0] ?? "installed"}`)];
  const status = await p.run(binary, ["auth", "status", "--json"], { env });
  const auth = parseAuthSummary(status.stdout);
  rows.push(
    auth.loggedIn
      ? result("claude-auth", "Claude Code sign-in", "ok", `signed in (${auth.authMethod ?? "unknown method"}${auth.subscriptionType ? `, plan ${auth.subscriptionType}` : ""})`)
      : result("claude-auth", "Claude Code sign-in", "info", "not signed in under TechTeam", "Sign in from Settings → AI → Plans on this computer, to use your plan."),
  );
  return rows;
}

/** @param {Probes} p */
export async function checkExtras(p) {
  const docker = await p.run("docker", ["--version"], { shell: true });
  const rows = [
    docker.code === 0
      ? result("docker", "Docker", "info", `found (${docker.stdout.trim().replace(/^Docker version\s+/, "").split(",")[0] ?? "installed"}), for the agent sandbox`)
      : result("docker", "Docker", "info", "not found (only needed for the agent sandbox)"),
  ];
  if (p.platform === "win32") {
    const wsl = await p.run("wsl", ["--status"], { shell: true });
    rows.push(
      wsl.code === 0
        ? result("wsl", "WSL", "info", "found, for the agent sandbox")
        : result("wsl", "WSL", "info", "not found (only needed for the agent sandbox)"),
    );
  }
  return rows;
}

/** @param {Probes} p */
export function checkEnvFile(p) {
  const label = ".env";
  if (p.envFileKeys === null) return [];
  const rows = [];
  const obsolete = obsoleteKeysSet(p.envFileKeys, p.env);
  rows.push(
    obsolete.length > 0
      ? result("env-obsolete", label, "warn", `no longer used: ${obsolete.join(", ")}`, "Delete these lines from .env: TechTeam ignores them.")
      : result("env-obsolete", label, "ok", "no obsolete settings"),
  );
  const id = p.env.GITHUB_CLIENT_ID?.trim();
  if (id && id !== DEFAULT_GITHUB_CLIENT_ID) {
    rows.push(result("env-client", label, "info", "GITHUB_CLIENT_ID is your own: its OAuth App needs Device Flow enabled"));
  }
  if (p.env.DATABASE_URL?.trim()) rows.push(result("env-database", label, "info", "DATABASE_URL is set: using your own database"));
  return rows;
}

/**
 * Every check, in the order they are printed.
 * @param {Probes} p
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(p) {
  const groups = await Promise.all([
    checkNode(p),
    checkTools(p),
    checkDataDir(p),
    checkPorts(p),
    checkDatabase(p),
    checkAppUrl(p),
    checkSecrets(p),
    checkGithub(p),
    checkClaude(p),
    checkExtras(p),
    checkEnvFile(p),
  ]);
  return groups.flat();
}
