// The local stack's ports and the build decision, pure and shared by `npm run start:local` and `npm run doctor`.

export const DEFAULT_APP_PORT = 3000;
export const DEFAULT_INNGEST_PORT = 8288;

/** The Inngest Dev Server version `npm run inngest:dev` and `start:local` run (pinned: no download of "latest" per start). */
export const INNGEST_CLI_VERSION = "1.53.0";

/**
 * Extra Dev Server flags for a non-default port, so a second stack on one computer doesn't collide on the Dev
 * Server's connect ports (gateway 8289, gRPC 50052/50053): they move by the same offset as the main port.
 * @param {number} port
 */
export function inngestPortFlags(port) {
  const offset = port - DEFAULT_INNGEST_PORT;
  if (offset === 0) return [];
  return ["--connect-gateway-port", String(8289 + offset), "--connect-gateway-grpc-port", String(50052 + offset), "--connect-executor-grpc-port", String(50053 + offset)];
}

/**
 * A port from a setting: a whole number from 1 to 65535, else the fallback.
 * @param {string | undefined} raw @param {number} fallback
 */
export function parsePortSetting(raw, fallback) {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return fallback;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : fallback;
}

/** The app's port: TECHTEAM_PORT (for tests beside a running copy), else 3000. @param {Record<string, string | undefined>} env */
export const resolveAppPort = (env) => parsePortSetting(env.TECHTEAM_PORT, DEFAULT_APP_PORT);

/** The Inngest Dev Server's port: TECHTEAM_INNGEST_PORT, else 8288. @param {Record<string, string | undefined>} env */
export const resolveInngestPort = (env) => parsePortSetting(env.TECHTEAM_INNGEST_PORT, DEFAULT_INNGEST_PORT);

/**
 * Whether `start:local` must build first, and why. Without git a build happens only when none exists.
 * @param {{ hasBuildId: boolean, storedRev: string | null, headRev: string | null, rebuild: boolean }} state
 * @returns {{ build: boolean, reason: string }}
 */
export function buildDecision({ hasBuildId, storedRev, headRev, rebuild }) {
  if (rebuild) return { build: true, reason: "--rebuild was given" };
  if (!hasBuildId) return { build: true, reason: "there is no build yet" };
  if (headRev !== null && storedRev !== headRev) {
    return { build: true, reason: storedRev === null ? "the build has no recorded revision" : "the code changed since the last build" };
  }
  return { build: false, reason: "the build is up to date" };
}
