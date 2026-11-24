// The second TechTeam that `npm run smoke` starts beside the owner's: its ports, folders and environment. Pure.
import path from "node:path";

export const SMOKE_APP_PORT = 3992;
export const SMOKE_INNGEST_PORT = 8294;
export const SMOKE_PG_PORT = 54794;
/** next.config.ts builds into this folder when TECHTEAM_DIST_DIR says so, so a running `next dev` keeps `.next`. */
export const SMOKE_DIST_DIR = ".next-smoke";

/** A port from an environment setting, else the default. @param {string | undefined} raw @param {number} fallback */
function port(raw, fallback) {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : fallback;
}

/** @param {Record<string, string | undefined>} env */
export function smokePorts(env) {
  return {
    app: port(env.SMOKE_APP_PORT, SMOKE_APP_PORT),
    inngest: port(env.SMOKE_INNGEST_PORT, SMOKE_INNGEST_PORT),
    pg: port(env.SMOKE_PG_PORT, SMOKE_PG_PORT),
  };
}

/** Settings of the outer environment that must never reach the stack: its own, the owner's, and anything secret. */
const INHERITED = /^(TECHTEAM_|SANDBOX_|AGENTS_|S3_|AUTH_|OPENAI_|ANTHROPIC_|OPENROUTER_|INNGEST_|JOBS_|GITHUB_|GH_|SMOKE_|NEXT_PUBLIC_|PUBLIC_APP_URL|CLAUDE_|DATABASE_URL$|TOKEN_ENCRYPTION_KEY$)/i;

/**
 * The stack's environment: the machine's (PATH and friends) without any TechTeam, provider or GitHub setting, plus
 * ours. DATABASE_URL and the encryption key are blank, not just absent: a `.env` in the project can't fill them in.
 * @param {Record<string, string | undefined>} base
 * @param {{ ports: { app: number, inngest: number, pg: number }, dataDir: string }} config
 * @returns {Record<string, string>}
 */
export function stackEnv(base, { ports, dataDir }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !INHERITED.test(key)) env[key] = value;
  return {
    ...env,
    DATABASE_URL: "",
    TOKEN_ENCRYPTION_KEY: "",
    INNGEST_EVENT_KEY: "",
    INNGEST_SIGNING_KEY: "",
    SANDBOX_DOCKER_HOST: "",
    S3_BUCKET: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${ports.app}`,
    TECHTEAM_DATA_DIR: dataDir,
    TECHTEAM_PORT: String(ports.app),
    TECHTEAM_INNGEST_PORT: String(ports.inngest),
    TECHTEAM_PG_PORT: String(ports.pg),
    TECHTEAM_DIST_DIR: SMOKE_DIST_DIR,
    TECHTEAM_SANDBOX: "off",
    AGENTS_SIMULATED: "true",
    AGENTS_AUTO_PICKUP: "false",
    AGENTS_LOCAL_CLI: "false",
    INNGEST_BASE_URL: `http://127.0.0.1:${ports.inngest}`,
  };
}

/** The folder under the OS temp dir where one smoke run keeps its data and logs. @param {string} tmp @param {string} suffix */
export const smokeDataDir = (tmp, suffix) => path.join(tmp, `techteam-smoke-${suffix}`);
