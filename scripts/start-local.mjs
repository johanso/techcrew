// `npm run start:local`: the stable way to leave agents working. One terminal runs the production build of the app,
// the Inngest Dev Server (pinned version) and, unless DATABASE_URL is set, the embedded database. Builds first when
// the code changed since the last build. Ctrl+C (or any one of them dying) stops all of them.
//   --rebuild   build even when the build is up to date
// TECHTEAM_PORT / TECHTEAM_INNGEST_PORT / TECHTEAM_PG_PORT move the three ports (docs/setup.md). TECHTEAM_DIST_DIR moves
// the build folder (next.config.ts); `npm run smoke` uses it to run a second stack beside a running TechTeam, and
// asks this one to stop through its IPC channel ("stop"), the way it asks the database launcher.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { portAnswers } from "../lib/doctor/probes.mjs";
import { embeddedApplies, resolvePort } from "../lib/local-db-config.mjs";
import { INNGEST_CLI_VERSION, buildDecision, inngestPortFlags, resolveAppPort, resolveInngestPort } from "../lib/local-stack-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const distDir = process.env.TECHTEAM_DIST_DIR?.trim() || ".next";
const buildIdFile = path.join(root, distDir, "BUILD_ID");
const revFile = path.join(root, distDir, ".techteam-build-rev");
const log = (message) => console.log(`[start] ${message}`);

if (process.argv.slice(2).some((arg) => arg !== "--rebuild")) {
  console.error("Usage: npm run start:local [-- --rebuild]");
  process.exit(2);
}

const appPort = resolveAppPort(process.env);
const inngestPort = resolveInngestPort(process.env);
const embedded = embeddedApplies(process.env);

/** The current commit, or null without git (then only a missing build triggers one). */
function headRevision() {
  const out = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return out.status === 0 ? out.stdout.trim() : null;
}

function readRevision() {
  try {
    return fs.readFileSync(revFile, "utf8").trim() || null;
  } catch {
    return null;
  }
}

const headRev = headRevision();
const decision = buildDecision({
  hasBuildId: fs.existsSync(buildIdFile),
  storedRev: readRevision(),
  headRev,
  rebuild: process.argv.includes("--rebuild"),
});

for (const [name, port] of [["app", appPort], ["Inngest", inngestPort], ...(embedded ? [["database", resolvePort(process.env)]] : [])]) {
  if (await portAnswers(port)) {
    console.error(`[start] The ${name} port ${port} is already in use. Run npm run doctor to see by what, or move it with TECHTEAM_PORT, TECHTEAM_INNGEST_PORT or TECHTEAM_PG_PORT.`);
    process.exit(1);
  }
}

if (decision.build) {
  log(`Building: ${decision.reason}.`);
  const built = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit", windowsHide: true });
  if (built.status !== 0) {
    console.error("[start] The build failed, nothing was started.");
    process.exit(built.status ?? 1);
  }
  if (headRev) fs.writeFileSync(revFile, `${headRev}\n`);
} else {
  log(`Not building: ${decision.reason}. (--rebuild forces it.)`);
}

/** Streams a child's output line by line with a prefix (the database launcher already prints its own). */
function pipeLines(stream, target, prefix) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) target.write(`${prefix}${line}\n`);
  });
  stream.on("end", () => {
    if (pending) target.write(`${prefix}${pending}\n`);
  });
}

const children = [];
let stopping = false;

/** Kills a child and everything it started: a process group on POSIX, `taskkill /T` on Windows. */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (windows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/** Stops everything: the database asked to stop cleanly first (it owns a Postgres), the rest killed with their trees. */
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  log("Stopping...");
  for (const entry of children) if (entry.name !== "db") killTree(entry.child);
  const db = children.find((entry) => entry.name === "db");
  if (db && db.child.exitCode === null) {
    db.child.send?.("stop");
    const deadline = Date.now() + 20_000;
    while (db.child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    killTree(db.child);
  }
  process.exit(code);
}

/** Starts one part of the stack. A part that ends takes the whole stack down, except the database launcher ending cleanly. */
function start(name, command, args, { shell = false, ipc = false, env = process.env, prefix = `[${name}] ` } = {}) {
  const options = { cwd: root, env, detached: !windows, windowsHide: true, stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])] };
  // With a shell the command line is one string (Node deprecates passing arguments); the parts are fixed or numbers.
  const child = shell ? spawn([command, ...args].join(" "), { ...options, shell: true }) : spawn(command, args, options);
  children.push({ name, child });
  pipeLines(child.stdout, process.stdout, prefix);
  pipeLines(child.stderr, process.stderr, prefix);
  child.on("error", (error) => {
    console.error(`[start] Could not start ${name}: ${error.message}`);
    void shutdown(1);
  });
  child.on("exit", (code) => {
    if (stopping) return;
    // The launcher exits 0 right away when it only reused a database that was already running.
    if (name === "db" && code === 0) return;
    console.error(`[start] ${name} stopped (code ${code ?? "none"}): stopping the rest.`);
    void shutdown(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(signal, () => void shutdown(0));
// A parent that started this with an IPC channel (npm run smoke) asks for a clean stop this way: Windows has no SIGTERM
// for another process.
process.on("message", (message) => {
  if (message === "stop") void shutdown(0);
});

if (embedded) {
  start("db", process.execPath, ["--env-file-if-exists=.env", "--env-file-if-exists=.env.local", "scripts/local-db.mjs"], { ipc: true, prefix: "" });
} else {
  log("DATABASE_URL is set: using that database, no embedded Postgres started.");
}
// The app sends its events to this Dev Server, not to the default port (another TechTeam may own that one).
start("app", process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  env: { ...process.env, INNGEST_BASE_URL: `http://127.0.0.1:${inngestPort}` },
});
start(
  "inngest",
  "npx",
  ["--yes", `inngest-cli@${INNGEST_CLI_VERSION}`, "dev", "-u", `http://127.0.0.1:${appPort}/api/inngest`, "--host", "127.0.0.1", "--port", String(inngestPort), ...inngestPortFlags(inngestPort)],
  { shell: windows },
);
log(`TechTeam: http://127.0.0.1:${appPort}   Inngest: http://127.0.0.1:${inngestPort}   Ctrl+C stops everything.`);
