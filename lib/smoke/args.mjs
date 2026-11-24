// `npm run smoke`: the command line, parsed. Pure.

export const DEFAULT_TIMEOUT_MINUTES = 12;

export const USAGE = "Usage: npm run smoke -- --repo <owner/name> [--keep] [--timeout <minutes>] [--reuse-build] [--i-know-this-repo-gets-junk]";

/**
 * @param {string[]} argv the arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, options: { repo: string | null, keep: boolean, timeoutMinutes: number, reuseBuild: boolean, anyRepoName: boolean } } | { ok: false, message: string }}
 */
export function parseSmokeArgs(argv, env) {
  let repo = env.SMOKE_REPO?.trim() || null;
  let keep = false;
  let reuseBuild = false;
  let anyRepoName = false;
  let timeoutMinutes = DEFAULT_TIMEOUT_MINUTES;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") keep = true;
    else if (arg === "--reuse-build") reuseBuild = true;
    else if (arg === "--i-know-this-repo-gets-junk") anyRepoName = true;
    else if (arg === "--repo" || arg === "--timeout") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return { ok: false, message: `${arg} needs a value.` };
      if (arg === "--repo") repo = value.trim();
      else {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) return { ok: false, message: "--timeout is a number of minutes from 1 to 120." };
        timeoutMinutes = minutes;
      }
    } else return { ok: false, message: `Unknown option ${arg}.` };
  }
  return { ok: true, options: { repo, keep, timeoutMinutes, reuseBuild, anyRepoName } };
}
