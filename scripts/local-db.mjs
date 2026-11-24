// `npm run db:local`: TechTeam's own Postgres, for when DATABASE_URL is unset (docs/setup.md#database).
// Creates the cluster once, starts it on 127.0.0.1, applies the pending migrations and stays up until stopped.
// `npm run dev` runs it beside the app and Inngest. It never reads or prints the generated password.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  PG_DATABASE,
  PG_USER,
  embeddedApplies,
  embeddedUrl,
  ensureSecret,
  pgDataDir,
  pidFileState,
  readSecret,
  readyPath,
  resolveDataDir,
  resolvePort,
} from "../lib/local-db-config.mjs";

const log = (message) => console.log(`[db] ${message}`);

if (!embeddedApplies(process.env)) {
  log("DATABASE_URL is set: using that database, no embedded Postgres started.");
  process.exit(0);
}

const dataDir = resolveDataDir(process.env);
const clusterDir = pgDataDir(dataDir);
const port = resolvePort(process.env);
const pidFile = path.join(clusterDir, "postmaster.pid");
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

// The app waits for this file: it exists only while the database is created and migrated.
const ready = readyPath(dataDir);
fs.rmSync(ready, { force: true });

const fresh = !fs.existsSync(path.join(clusterDir, "PG_VERSION"));
if (fresh) fs.mkdirSync(clusterDir, { recursive: true });
if (!fresh && readSecret(dataDir) === null) {
  throw new Error(`The database in ${clusterDir} has no postgres.secret next to it. Remove the postgres folder to start over.`);
}
const secret = ensureSecret(dataDir, () => randomBytes(24).toString("hex"));

/** Applies the pending migrations: the same SQL `npm run db:migrate` applies. */
async function runMigrations() {
  const client = postgres(embeddedUrl(port, secret), { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const state = pidFileState(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8") : null);

if (state === "running") {
  // Another TechTeam Postgres already owns this data dir (a second `npm run dev`, or one a hard kill orphaned).
  try {
    await runMigrations();
    fs.writeFileSync(ready, "");
  } catch {
    console.error(
      `[db] A Postgres process is running for ${clusterDir} but not reachable on port ${port}. ` +
        `Stop it, or if the pid file is left over from another program, delete ${pidFile}.`,
    );
    process.exit(1);
  }
  log(`Database ready on 127.0.0.1:${port} (already running, reusing it).`);
  process.exit(0);
}

if (state === "stale") {
  // A hard kill leaves the pid file of a server that is gone; Postgres would refuse to start with it.
  fs.rmSync(pidFile, { force: true });
  log("Removed a stale postmaster.pid from an earlier hard stop.");
}

// Imported only now: the package installs exit hooks that must not run when we only reuse a running server.
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const pg = new EmbeddedPostgres({
  databaseDir: clusterDir,
  user: PG_USER,
  password: secret,
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (error) => console.error("[db]", error instanceof Error ? error.message : String(error)),
});

if (fresh) {
  log("Creating the database (first run only)...");
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase(PG_DATABASE);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  fs.rmSync(ready, { force: true });
  try {
    await pg.stop();
  } catch (error) {
    console.error("[db] Could not stop Postgres cleanly:", error instanceof Error ? error.message : String(error));
  }
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// A supervisor that started this with an IPC channel (npm run start:local) asks for a clean stop this way: Windows
// has no SIGTERM for another process, and a hard kill would leave Postgres running.
process.on("message", (message) => {
  if (message === "stop") void stop();
});

try {
  await runMigrations();
} catch (error) {
  console.error("[db] Migrations failed:", error instanceof Error ? error.message : String(error));
  await stop();
}
fs.writeFileSync(ready, "");

log(`Database ready on 127.0.0.1:${port} (data in ${clusterDir}).`);
// Postgres is a child process: keep this one alive until it's told to stop.
setInterval(() => {}, 1 << 30);
