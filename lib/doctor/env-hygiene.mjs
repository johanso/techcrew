// `.env` hygiene for `npm run doctor`: only key NAMES are looked at here, never a value.

/** Settings of the hosted version that nothing reads any more (exact names; the prefixes below were whole families). */
const OBSOLETE_NAMES = new Set([
  "AUTH_URL",
  "AUTH_PUBLISHABLE_KEY",
  "AUTH_SECRET_KEY",
  "GITHUB_CLIENT_SECRET",
  "PUBLIC_APP_URL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
]);
const OBSOLETE_PREFIXES = ["S3_", "JOBS_", "SWITCH_"];

/** @param {string} name */
export function isObsoleteName(name) {
  return OBSOLETE_NAMES.has(name) || OBSOLETE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * The names of the obsolete settings that are set (non-empty) in `env`, limited to the names a `.env` file declares.
 * @param {string[]} fileKeys names declared in .env / .env.local
 * @param {Record<string, string | undefined>} env the loaded environment
 */
export function obsoleteKeysSet(fileKeys, env) {
  return [...new Set(fileKeys)].filter((name) => isObsoleteName(name) && Boolean(env[name]?.trim())).sort();
}

/**
 * The variable names an env file declares (`KEY=…`, `export KEY=…`; comments and blank lines skipped). Values are
 * never returned.
 * @param {string} content
 */
export function parseEnvKeyNames(content) {
  const names = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}
