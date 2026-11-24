// The real probes of `npm run doctor`: the only place the doctor touches the machine. Every one is read-only and
// bounded by a timeout; a failure is an answer ("no"), never a crash.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import postgres from "postgres";

import { processAlive } from "../local-db-config.mjs";
import { parseEnvKeyNames } from "./env-hygiene.mjs";

const RUN_TIMEOUT_MS = 15_000;

/** @param {string} dir the nearest folder that exists, going up from `dir` */
function nearestExisting(dir) {
  let current = path.resolve(dir);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/** A command to completion with a deadline. A shell only for the fixed names the doctor passes (npm, git, tar, docker, wsl). */
function run(/** @type {string} */ command, /** @type {string[]} */ args, /** @type {{ env?: Record<string, string>, shell?: boolean }} */ options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    // With a shell the command line is one string (Node deprecates passing arguments); the names and flags are fixed.
    const child = options.shell
      ? spawn([command, ...args].join(" "), { env: options.env ?? process.env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(command, args, { env: options.env ?? process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout = (stdout + chunk).slice(-50_000)));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-50_000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Whether something accepts a connection on 127.0.0.1:port. The socket is closed at once; nothing is sent. @param {number} port */
export function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (/** @type {boolean} */ answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The program listening on a port, from the system's own tools; null when they don't say. @param {number} port */
async function portOwner(port) {
  if (process.platform === "win32") {
    const table = await run("netstat", ["-ano", "-p", "tcp"]);
    const line = table.stdout.split(/\r?\n/).find((entry) => new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+\\d+`).test(entry));
    const pid = line?.trim().split(/\s+/).pop();
    if (!pid || !/^\d+$/.test(pid)) return null;
    const task = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const name = /^"([^"]+)"/.exec(task.stdout.trim())?.[1];
    return name ? `${name} (pid ${pid})` : `pid ${pid}`;
  }
  const listing = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fcp"]);
  const pid = /^p(\d+)/m.exec(listing.stdout)?.[1];
  const name = /^c(.+)$/m.exec(listing.stdout)?.[1];
  return pid ? `${name ?? "a program"} (pid ${pid})` : null;
}

/** @param {string} url */
async function getJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** @param {string} url */
async function reachable(url) {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

/** `select 1`, then how many migrations drizzle recorded (null when its table doesn't exist). Read-only. @param {string} url */
async function queryDatabase(url) {
  const client = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5, idle_timeout: 2 });
  try {
    await client.unsafe("select 1");
    const [exists] = await client.unsafe("select to_regclass('drizzle.__drizzle_migrations') is not null as present");
    if (!exists?.present) return { reachable: true, applied: null };
    const [count] = await client.unsafe("select count(*)::int as n from drizzle.__drizzle_migrations");
    return { reachable: true, applied: typeof count?.n === "number" ? count.n : null };
  } catch {
    return { reachable: false, applied: null };
  } finally {
    await client.end({ timeout: 2 }).catch(() => {});
  }
}

/** The key names declared in .env and .env.local, null when neither file exists. @param {string} root */
function envFileKeys(root) {
  const names = [];
  let found = false;
  for (const file of [".env", ".env.local"]) {
    try {
      names.push(...parseEnvKeyNames(fs.readFileSync(path.join(root, file), "utf8")));
      found = true;
    } catch {
      // No such file.
    }
  }
  return found ? names : null;
}

/** The probes on this computer. @param {string} root the repository folder @returns {import("./checks.mjs").Probes} */
export function realProbes(root) {
  return {
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    nodeVersion: process.versions.node,
    root,
    exists: (file) => fs.existsSync(file),
    readText: (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    canWrite: (dir) => {
      try {
        fs.accessSync(nearestExisting(dir), fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    freeBytes: (dir) => {
      try {
        const stats = fs.statfsSync(nearestExisting(dir));
        return stats.bavail * stats.bsize;
      } catch {
        return null;
      }
    },
    run,
    portAnswers,
    portOwner,
    getJson,
    reachable,
    pidAlive: processAlive,
    queryDatabase,
    envFileKeys: envFileKeys(root),
  };
}
