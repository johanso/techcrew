// What plain node (the doctor, `npm run sandbox:setup`) and the app (lib/sandbox/mode.ts) both need to know about the
// local Docker engine and the two sandbox images. Pure: no process, no files.

/** The sandbox containers' image unless SANDBOX_IMAGE says otherwise. */
export const SANDBOX_IMAGE_DEFAULT = "node:24-bookworm";

/**
 * The browser image built from deploy/browser (deploy/browser/Dockerfile): Playwright's version, then the scripts'
 * revision (2: link capture, tablet, color scheme; 3: fonts with real bold weights). Bump it with the Dockerfile.
 * Override with SANDBOX_BROWSER_IMAGE.
 */
export const BROWSER_IMAGE_TAG = "techteam-browser:1.64.1-4";

/** @param {Record<string, string | undefined>} env */
export const sandboxImageName = (env) => env.SANDBOX_IMAGE?.trim() || SANDBOX_IMAGE_DEFAULT;

/** @param {Record<string, string | undefined>} env */
export const browserImageName = (env) => env.SANDBOX_BROWSER_IMAGE?.trim() || BROWSER_IMAGE_TAG;

/** The format string of the probe: `<OSType>|<ServerVersion>`. */
export const DOCKER_INFO_FORMAT = "{{.OSType}}|{{.ServerVersion}}";

/**
 * `docker info --format DOCKER_INFO_FORMAT` → what the engine is. Anything that isn't a clean answer means stopped.
 * @param {{ code: number | null, stdout: string, errorCode?: string | null, timedOut?: boolean }} outcome
 * @returns {{ kind: "missing" } | { kind: "stopped" } | { kind: "engine", osType: string, version: string }}
 */
export function parseDockerInfo(outcome) {
  if (outcome.errorCode === "ENOENT") return { kind: "missing" };
  if (outcome.timedOut || outcome.code !== 0) return { kind: "stopped" };
  const [osType = "", version = ""] = outcome.stdout.trim().split("|");
  if (!/^[a-z]+$/i.test(osType.trim())) return { kind: "stopped" };
  return { kind: "engine", osType: osType.trim().toLowerCase(), version: version.trim() };
}
