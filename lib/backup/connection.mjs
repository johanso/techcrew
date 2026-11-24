// Which database a backup or restore talks to: DATABASE_URL when set, else the embedded one (the same rule as
// db/index.ts, from lib/local-db-config.mjs). It never prints the URL or the generated password.
import fs from "node:fs";

import postgres from "postgres";

import { embeddedApplies, embeddedUrl, readSecret, readyPath, resolveDataDir, resolvePort } from "../local-db-config.mjs";

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string; label: string }}
 */
export function resolveDatabase(env) {
  if (!embeddedApplies(env)) return { url: /** @type {string} */ (env.DATABASE_URL).trim(), label: "the database in DATABASE_URL" };
  const dataDir = resolveDataDir(env);
  const secret = readSecret(dataDir);
  if (secret === null || !fs.existsSync(readyPath(dataDir))) {
    throw new Error(
      "The embedded database is not running. Start it first in another terminal: `npm run db:local` (or `npm run dev`), wait for \"Database ready\", then run this again. " +
        "To use another database, set DATABASE_URL.",
    );
  }
  return { url: embeddedUrl(resolvePort(env), secret), label: `the embedded database in ${dataDir}` };
}

/**
 * One connection. `prepare: false` matches db/index.ts (works behind poolers).
 * @param {string} url
 */
export function connect(url) {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
}
