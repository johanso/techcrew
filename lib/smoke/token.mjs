// Where `npm run smoke` gets its GitHub token: SMOKE_GITHUB_TOKEN, else the GitHub CLI's. The token is never printed,
// written or passed as an argument: `gh auth token` takes none and prints it on stdout.
import path from "node:path";

export const NO_TOKEN_MESSAGE =
  "No GitHub token. Set SMOKE_GITHUB_TOKEN to a token with the repo scope, or log in to the GitHub CLI (gh auth login) so `gh auth token` has one.";

/**
 * Folders the GitHub CLI installs to when its folder isn't on PATH.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function ghFolders(env, platform = process.platform) {
  if (platform === "win32") {
    return [
      env.ProgramFiles ? path.win32.join(env.ProgramFiles, "GitHub CLI") : "",
      env["ProgramFiles(x86)"] ? path.win32.join(env["ProgramFiles(x86)"], "GitHub CLI") : "",
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Programs", "GitHub CLI") : "",
      "C:\\Program Files\\GitHub CLI",
    ].filter(Boolean);
  }
  return ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];
}

/**
 * The GitHub CLI's executable: on PATH, else in a default install folder.
 * @param {Record<string, string | undefined>} env
 * @param {(file: string) => boolean} exists
 * @returns {string | null}
 */
export function findGh(env, exists, platform = process.platform) {
  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const onPath = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  for (const folder of [...onPath, ...ghFolders(env, platform)]) {
    const candidate = join(folder, windows ? "gh.exe" : "gh");
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {{ env: Record<string, string | undefined>, ghPath: string | null, readGh: (ghPath: string) => { status: number | null, stdout: string } }} input
 * @returns {{ ok: true, token: string, source: "env" | "gh" } | { ok: false, message: string }}
 */
export function resolveToken({ env, ghPath, readGh }) {
  const fromEnv = env.SMOKE_GITHUB_TOKEN?.trim();
  if (fromEnv) {
    return /\s/.test(fromEnv) ? { ok: false, message: "SMOKE_GITHUB_TOKEN contains whitespace: it isn't a token." } : { ok: true, token: fromEnv, source: "env" };
  }
  if (!ghPath) return { ok: false, message: `${NO_TOKEN_MESSAGE} (The GitHub CLI wasn't found on PATH or in its default install folders.)` };
  const out = readGh(ghPath);
  const token = out.stdout.trim();
  if (out.status !== 0 || !token || /\s/.test(token)) return { ok: false, message: `${NO_TOKEN_MESSAGE} (The GitHub CLI has no token: it isn't logged in.)` };
  return { ok: true, token, source: "gh" };
}

/**
 * Removes every secret (and anything shaped like a GitHub token) from text that is about to be shown.
 * @param {string} text
 * @param {string[]} secrets
 */
export function scrub(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret.length >= 8) out = out.split(secret).join("***");
  return out.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "***");
}
