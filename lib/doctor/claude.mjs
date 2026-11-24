// Where Claude Code lives, and what its `auth status` says, for `npm run doctor`. Pure: mirrors lib/cli/index.ts
// (claudeCandidates, childEnv, parseCliAuth) without importing that server-only module.
import path from "node:path";

/**
 * Where Claude Code's native installer and Homebrew put it, per OS; CLAUDE_CLI_PATH first.
 * @param {{ platform: string, home: string, env: Record<string, string | undefined> }} where
 */
export function claudeCandidates({ platform, home, env }) {
  const explicit = env.CLAUDE_CLI_PATH ? [env.CLAUDE_CLI_PATH] : [];
  if (platform === "win32") {
    const win = path.win32;
    const profile = env.USERPROFILE || home;
    return [...explicit, win.join(profile, ".local", "bin", "claude.exe"), ...(env.APPDATA ? [win.join(env.APPDATA, "npm", "claude.cmd")] : [])];
  }
  const posix = path.posix;
  return [...explicit, posix.join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", posix.join(home, ".claude", "local", "claude")];
}

/** An npm shim: TechTeam refuses it on Windows because it needs a shell. @param {string} binary */
export const isNpmShim = (binary) => binary.toLowerCase().endsWith(".cmd");

const CHILD_ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT", "ComSpec"];

/**
 * The environment Claude Code runs in for TechTeam: an allowlist plus TechTeam's own config dir.
 * @param {Record<string, string | undefined>} env
 * @param {string} configDir
 * @returns {Record<string, string>}
 */
export function claudeChildEnv(env, configDir) {
  /** @type {Record<string, string>} */
  const out = { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CONFIG_DIR: configDir };
  for (const key of CHILD_ENV_KEYS) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * TechTeam's CLI home: TECHTEAM_CLI_HOME, else ~/.techteam/cli. Claude's config dir is the `claude` folder in it.
 * @param {Record<string, string | undefined>} env @param {string} home
 */
export function claudeConfigDir(env, home) {
  return path.join(env.TECHTEAM_CLI_HOME || path.join(home, ".techteam", "cli"), "claude");
}

/**
 * What `claude auth status --json` says, reduced to what the doctor shows: signed in, how, which plan. The account's
 * email and organization are dropped here, so they can't reach any output.
 * @param {string} stdout
 * @returns {{ loggedIn: boolean, authMethod: string | null, subscriptionType: string | null }}
 */
export function parseAuthSummary(stdout) {
  /** @type {unknown} */
  let raw = null;
  try {
    raw = JSON.parse(stdout);
  } catch {
    raw = null;
  }
  const data = typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
  const text = (/** @type {unknown} */ value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    loggedIn: data.loggedIn === true,
    authMethod: text(data.authMethod),
    subscriptionType: text(data.subscriptionType)?.toLowerCase() ?? null,
  };
}
