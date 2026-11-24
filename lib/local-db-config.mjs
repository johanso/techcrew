// The embedded Postgres' settings, pure and shared by the app (db/index.ts, drizzle.config.ts) and the launcher
// (scripts/local-db.mjs). It is a plain .mjs (JSDoc types) so `node` runs it with no build step and Next, drizzle-kit
// and Vitest import it as they do any module. The only I/O is the two small file readers at the bottom.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PG_PORT = 54329;
export const PG_HOST = "127.0.0.1";
export const PG_USER = "techteam";
export const PG_DATABASE = "techteam";
const SECRET_FILE = "postgres.secret";

/**
 * Where TechTeam keeps its data: TECHTEAM_DATA_DIR (trimmed), else ~/.techteam/data.
 * @param {Record<string, string | undefined>} env
 * @param {string} [home]
 */
export function resolveDataDir(env, home = os.homedir()) {
  const fromEnv = env.TECHTEAM_DATA_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(home, ".techteam", "data");
}

/** The cluster's folder, inside the data dir. @param {string} dataDir */
export function pgDataDir(dataDir) {
  return path.join(dataDir, "postgres");
}

/** The generated password's file, next to (not inside) the cluster. @param {string} dataDir */
export function secretPath(dataDir) {
  return path.join(dataDir, SECRET_FILE);
}

/** Written by the launcher once the database exists and is migrated; the app waits for it. @param {string} dataDir */
export function readyPath(dataDir) {
  return path.join(dataDir, "postgres.ready");
}

/** The embedded database is used only when DATABASE_URL is unset or blank. @param {Record<string, string | undefined>} env */
export function embeddedApplies(env) {
  return !env.DATABASE_URL?.trim();
}

/** TECHTEAM_PG_PORT when it is a valid port, else the default. @param {Record<string, string | undefined>} env */
export function resolvePort(env) {
  const raw = env.TECHTEAM_PG_PORT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_PG_PORT;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : DEFAULT_PG_PORT;
}

/**
 * Connection URL of the embedded database. The secret is hex, so it needs no escaping.
 * @param {number} port
 * @param {string} secret
 */
export function embeddedUrl(port, secret) {
  return `postgresql://${PG_USER}:${encodeURIComponent(secret)}@${PG_HOST}:${port}/${PG_DATABASE}`;
}

/**
 * The pid in a postmaster.pid (its first line), or null when the file is empty or malformed.
 * @param {string} content
 */
export function parsePidFile(content) {
  const first = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!/^\d+$/.test(first)) return null;
  const pid = Number(first);
  return pid > 0 ? pid : null;
}

/**
 * Whether a process exists (signal 0 sends nothing). EPERM means it exists but isn't ours.
 * @param {number} pid
 */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * What a cluster's postmaster.pid says: no file, a running server to reuse, or a stale file left by a hard kill.
 * @param {string | null} content the file's text, null when it doesn't exist
 * @param {(pid: number) => boolean} [alive]
 * @returns {"none" | "running" | "stale"}
 */
export function pidFileState(content, alive = processAlive) {
  if (content === null) return "none";
  const pid = parsePidFile(content);
  return pid !== null && alive(pid) ? "running" : "stale";
}

/** A secret kept in a file of the data dir, or null before its first use. @param {string} dataDir @param {string} name */
export function readSecretFile(dataDir, name) {
  try {
    return fs.readFileSync(path.join(dataDir, name), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * A generated secret in `<dataDir>/<name>`, created once with owner-only permissions where the system supports it.
 * Two processes starting together can't end up with different secrets: the file is created exclusively and the loser
 * reads the winner's.
 * @param {string} dataDir @param {string} name @param {() => string} generate
 */
export function ensureSecretFile(dataDir, name, generate) {
  const existing = readSecretFile(dataDir, name);
  if (existing) return existing;
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = generate();
  try {
    fs.writeFileSync(path.join(dataDir, name), `${secret}
`, { mode: 0o600, flag: "wx" });
    return secret;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const winner = readSecretFile(dataDir, name);
      if (winner) return winner;
    }
    throw error;
  }
}

/** The saved password, or null before the first start. @param {string} dataDir */
export function readSecret(dataDir) {
  return readSecretFile(dataDir, SECRET_FILE);
}

/** A random password, written once with owner-only permissions where the system supports it. @param {string} dataDir @param {() => string} generate */
export function ensureSecret(dataDir, generate) {
  return ensureSecretFile(dataDir, SECRET_FILE, generate);
}
