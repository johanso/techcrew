// `npm run smoke`: one card through the whole agent pipeline in simulated mode, against a throwaway GitHub repository
// (docs/testing.md#smoke-test). It starts its own TechTeam (own ports, build folder, temp database and data folder),
// seeds a user, a workspace on the repository and one card, starts the run the way the Run button does, waits for the
// pull request to be ready to merge, checks GitHub, and cleans up (also on failure and Ctrl+C). It never touches a
// TechTeam that is already running, and it never prints, writes or passes on a command line the GitHub token.
//   npm run smoke -- --repo owner/name [--keep] [--timeout <minutes>] [--reuse-build]
// Exit codes: 0 passed, 1 failed, 2 refused (nothing was started).
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { portAnswers } from "../lib/doctor/probes.mjs";
import { embeddedUrl, ensureSecretFile, processAlive, parsePidFile, pgDataDir, readSecret, readyPath } from "../lib/local-db-config.mjs";
import { USAGE, parseSmokeArgs } from "../lib/smoke/args.mjs";
import { planCleanup } from "../lib/smoke/cleanup.mjs";
import { githubClient } from "../lib/smoke/github.mjs";
import { checkRepoAccess, checkRepoGuard } from "../lib/smoke/guard.mjs";
import { checkPipeline, decidePoll, describeChange, formatSummary, lastLogLines, stageRows, tailLines } from "../lib/smoke/run.mjs";
import { SMOKE_CARD_TITLE, encryptToken, seedDatabase } from "../lib/smoke/seed.mjs";
import { smokePorts, stackEnv } from "../lib/smoke/stack.mjs";
import { findGh, resolveToken, scrub } from "../lib/smoke/token.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const secrets = [];
const say = (message) => console.log(scrub(`[smoke] ${message}`, secrets));
const warn = (message) => console.error(scrub(`[smoke] ${message}`, secrets));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = Date.now();

/** A check of the run that failed: reported once, then cleaned up after. */
class SmokeFailure extends Error {}
/** A precondition that isn't met: nothing was started yet (exit code 2). */
class Refused extends Error {}

const parsed = parseSmokeArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  warn(`${parsed.message}\n${USAGE}`);
  process.exit(2);
}
const { options } = parsed;

// State the cleanup needs.
let github = null;
let repo = null;
let defaultBranch = "main";
// Null until read: without the list from before the run, nothing on GitHub is ever deleted.
let agentBranchesBefore = null;
let tempDir = null;
let dataDir = null;
let stack = null;
let stackExited = false;
let sql = null;
let logFile = null;
let cleaned = false;

/** Stops `child` and everything it started: a process group on POSIX, `taskkill /T` on Windows. */
function killTree(pid) {
  if (!pid) return;
  if (windows) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** Asks the stack to stop itself (start-local stops the database cleanly), then kills what is left. */
async function stopStack() {
  if (!stack) return;
  if (!stackExited && stack.connected) {
    say("Stopping the smoke stack...");
    stack.send("stop");
    for (let i = 0; i < 120 && !stackExited; i++) await sleep(250);
  }
  if (!stackExited) killTree(stack.pid);
  // A Postgres that outlived its launcher: its pid is in our own data folder, so it is ours to stop.
  try {
    const pid = parsePidFile(fs.readFileSync(path.join(pgDataDir(dataDir), "postmaster.pid"), "utf8"));
    if (pid && processAlive(pid)) killTree(pid);
  } catch {
    // No pid file: no database was left.
  }
  for (let i = 0; i < 40 && stackExited === false && stack.exitCode === null; i++) await sleep(250);
}

/** Closes the pull request and deletes the branches this run created, in the throwaway repository only. */
async function cleanGithub() {
  if (!github || !repo || !agentBranchesBefore) return;
  const after = await github.agentBranches(repo);
  const plan = planCleanup({ defaultBranch, before: agentBranchesBefore, after, openPulls: await github.openPulls(repo) });
  for (const number of plan.closePulls) await github.closePull(repo, number);
  for (const branch of plan.deleteBranches) await github.deleteBranch(repo, branch);
  const leftoverBranches = (await github.agentBranches(repo)).filter((name) => plan.deleteBranches.includes(name));
  const leftoverPulls = (await github.openPulls(repo)).filter((pull) => plan.closePulls.includes(pull.number));
  if (leftoverBranches.length || leftoverPulls.length) {
    throw new Error(`GitHub still has ${leftoverBranches.join(", ") || "no branches"} and open PRs ${leftoverPulls.map((pull) => `#${pull.number}`).join(", ") || "none"} in ${repo}.`);
  }
  say(`GitHub cleaned: closed ${plan.closePulls.length} pull request(s), deleted ${plan.deleteBranches.length} branch(es) in ${repo}.`);
}

/** Everything the smoke started, stopped and removed. Safe to call twice. */
async function cleanup() {
  if (cleaned) return true;
  cleaned = true;
  let clean = true;
  if (options.keep) {
    say("--keep: NOTHING was cleaned up.");
    if (repo) say(`  GitHub: the pull request and the agent/* branches stay in ${repo}. Close and delete them yourself.`);
    if (stack?.pid) say(`  Stack: still running on http://127.0.0.1:${smokePorts(process.env).app} (pid ${stack.pid}); stop it with ${windows ? `taskkill /pid ${stack.pid} /T /F` : `kill -- -${stack.pid}`}.`);
    if (tempDir) say(`  Data and logs: ${tempDir} (delete it after stopping the stack).`);
    stack?.disconnect?.();
    stack?.unref();
    await sql?.end({ timeout: 2 }).catch(() => {});
    return true;
  }
  await sql?.end({ timeout: 2 }).catch(() => {});
  try {
    await stopStack();
  } catch (error) {
    clean = false;
    warn(`Could not stop the stack cleanly: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await cleanGithub();
  } catch (error) {
    clean = false;
    warn(`GITHUB CLEANUP FAILED: ${error instanceof Error ? error.message : String(error)} Close the smoke pull request and delete the agent/* branches in ${repo} by hand.`);
  }
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    } catch (error) {
      clean = false;
      warn(`Could not delete ${tempDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return clean;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    warn(`${signal}: cleaning up...`);
    void cleanup().finally(() => process.exit(1));
  });
}

/** Prints new `[start]` lines of the stack's log as it builds and starts, and a heartbeat when nothing new came. */
function createLogWatcher() {
  let offset = 0;
  let lastPrint = Date.now();
  return () => {
    let fresh = "";
    try {
      const buffer = fs.readFileSync(logFile);
      fresh = buffer.subarray(offset).toString("utf8");
      offset = buffer.length;
    } catch {
      return;
    }
    const lines = fresh.split(/\r?\n/).filter((line) => /^\[(start|db)\]/.test(line));
    for (const line of lines) say(line);
    if (lines.length) lastPrint = Date.now();
    else if (Date.now() - lastPrint > 20_000) {
      say(`still starting... (${Math.round((Date.now() - startedAt) / 1000)}s)`);
      lastPrint = Date.now();
    }
  };
}

/** Resolves when `check` is true; fails when the stack dies or the time is up. @param {string} what @param {() => Promise<boolean>} check */
async function waitFor(what, check, timeoutMs, watch) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    watch?.();
    if (stackExited) throw new SmokeFailure(`The smoke stack stopped while waiting for ${what}.`);
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new SmokeFailure(`Timed out waiting for ${what}.`);
    await sleep(1500);
  }
}

const httpOk = async (url, predicate = () => true) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  return response.ok && predicate(await response.text());
};

async function main() {
  // (a) Preconditions: the guard, the token, access to the repository, free ports.
  const guard = checkRepoGuard({ repo: options.repo, anyRepoName: options.anyRepoName });
  if (!guard.ok) throw new Refused(guard.message);
  repo = guard.repo;
  const ghPath = findGh(process.env, (file) => fs.existsSync(file));
  const token = resolveToken({
    env: process.env,
    ghPath,
    readGh: (exe) => {
      const out = spawnSync(exe, ["auth", "token"], { encoding: "utf8", windowsHide: true });
      return { status: out.status, stdout: out.stdout ?? "" };
    },
  });
  if (!token.ok) throw new Refused(token.message);
  secrets.push(token.token);
  github = githubClient(token.token);
  say(`GitHub token from ${token.source === "env" ? "SMOKE_GITHUB_TOKEN" : "the GitHub CLI"}.`);
  const user = await github.user().catch((error) => {
    throw new Refused(`GitHub didn't accept the token (${error instanceof Error ? error.message : "no answer"}).`);
  });
  const apiRepo = await github.repo(repo).catch((error) => {
    throw new Refused(`Could not read ${repo} (${error instanceof Error ? error.message : "no answer"}).`);
  });
  if (!apiRepo) throw new Refused(`${repo} doesn't exist, or this token can't see it.`);
  const access = checkRepoAccess(apiRepo);
  if (!access.ok) throw new Refused(access.message);
  defaultBranch = apiRepo.default_branch;
  const ports = smokePorts(process.env);
  for (const [name, port] of [["app", ports.app], ["Inngest", ports.inngest], ["database", ports.pg]]) {
    if (await portAnswers(port)) throw new Refused(`The smoke's ${name} port ${port} is in use (is another smoke running?). Move it with SMOKE_APP_PORT, SMOKE_INNGEST_PORT or SMOKE_PG_PORT.`);
  }
  say(`Repository ${repo} (default branch ${defaultBranch}); ports app ${ports.app}, Inngest ${ports.inngest}, database ${ports.pg}.`);

  agentBranchesBefore = await github.agentBranches(repo);
  if (agentBranchesBefore.length) warn(`${repo} already has agent/* branches (${agentBranchesBefore.length}); they are left alone.`);

  // (b) The stack: its own folder for data and logs, its own build, its own ports.
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "techteam-smoke-"));
  dataDir = path.join(tempDir, "data");
  logFile = path.join(tempDir, "stack.log");
  const encryptionKey = ensureSecretFile(dataDir, "encryption.key", () => randomBytes(32).toString("base64"));
  const env = stackEnv(process.env, { ports, dataDir });
  const logFd = fs.openSync(logFile, "a");
  say(`Starting the stack (${options.reuseBuild ? "reusing the smoke build if it is current" : "building first"}; logs in ${logFile}).`);
  stack = spawn(process.execPath, ["scripts/start-local.mjs", ...(options.reuseBuild ? [] : ["--rebuild"])], {
    cwd: root,
    env,
    detached: !windows,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd, "ipc"],
  });
  fs.closeSync(logFd);
  stack.on("exit", () => {
    stackExited = true;
  });
  const watch = createLogWatcher();
  await waitFor("the database", async () => fs.existsSync(readyPath(dataDir)), 12 * 60_000, watch);
  await waitFor("the app", () => httpOk(`http://127.0.0.1:${ports.app}/api/inngest`), 5 * 60_000, watch);
  await waitFor("Inngest to register the pipeline", () => httpOk(`http://127.0.0.1:${ports.inngest}/dev`, (text) => text.includes("agent-task-run")), 3 * 60_000, watch);
  say("The stack is up.");

  // (c) The test data, in the temp database.
  sql = postgres(embeddedUrl(ports.pg, readSecret(dataDir)), { max: 2, onnotice: () => {}, connect_timeout: 15 });
  const ids = await seedDatabase(sql, {
    github: { id: user.id, login: user.login, avatarUrl: user.avatar_url ?? null },
    encryptedToken: encryptToken(token.token, Buffer.from(encryptionKey, "base64")),
    repo: { id: apiRepo.id, fullName: apiRepo.full_name, htmlUrl: apiRepo.html_url, defaultBranch, private: apiRepo.private },
  });
  say(`Seeded workspace ${ids.workspaceId} and card "${SMOKE_CARD_TITLE}".`);

  // (d) Start the run with the app's own functions.
  const starter = spawnSync(process.execPath, ["scripts/smoke-start-run.mjs", String(ids.workspaceId), String(ids.taskId)], { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
  const started = /\{"runId":\s*(\d+)\}/.exec(starter.stdout ?? "");
  if (starter.status !== 0 || !started) {
    throw new SmokeFailure(`The run didn't start: ${tailLines(`${starter.stderr ?? ""}\n${starter.stdout ?? ""}`, 8).join(" | ") || "no output"}`);
  }
  const runId = Number(started[1]);
  say(`Run ${runId} queued.`);

  // (e) Wait for the pull request to be ready to merge.
  const timeoutMs = options.timeoutMinutes * 60_000;
  const pollStart = Date.now();
  let previous = null;
  let run = null;
  for (;;) {
    [run] = await sql`select id, status, stage, branch, error, started_at as "startedAt" from agent_runs where id = ${runId}`;
    const change = run ? describeChange(previous, run) : null;
    if (change) say(`${Math.round((Date.now() - pollStart) / 1000)}s  ${change}`);
    previous = run ?? null;
    const decision = decidePoll(run, { elapsedMs: Date.now() - pollStart, timeoutMs });
    if (decision.action === "fail") throw new SmokeFailure(decision.reason);
    if (decision.action === "done") break;
    if (stackExited) throw new SmokeFailure("The smoke stack stopped while the run was in flight.");
    await sleep(4000);
  }
  const steps = await sql`select stage, round, turn, seq, tool, target, ok, summary, created_at as "createdAt" from agent_run_steps where run_id = ${runId} order by id`;
  const pipeline = checkPipeline(steps);
  if (!pipeline.ok) throw new SmokeFailure(`The pipeline didn't pass:\n  ${pipeline.problems.join("\n  ")}`);

  // (f) GitHub has what the run says it made.
  const branch = run.branch;
  if (!branch) throw new SmokeFailure("The run has no branch.");
  if (!(await github.branchExists(repo, branch))) throw new SmokeFailure(`Branch ${branch} doesn't exist in ${repo}.`);
  const note = `agent-simulations/${branch.replace(/^agent\//, "")}.md`;
  if (!(await github.fileExists(repo, note, branch))) throw new SmokeFailure(`The simulation note ${note} isn't on ${branch}.`);
  const pull = (await github.openPulls(repo)).find((entry) => entry.head === branch);
  if (!pull) throw new SmokeFailure(`There is no open pull request from ${branch}.`);
  const live = await github.pull(repo, pull.number);
  if (live.state !== "open") throw new SmokeFailure(`PR #${pull.number} isn't open.`);

  // (h) The summary.
  console.log(`\n${formatSummary(stageRows(steps, run.startedAt), { totalSeconds: Math.round((Date.now() - startedAt) / 1000), outcome: "PASSED", pullRequest: pull.number, branch })}\n`);
  return 0;
}

/** What a failed smoke shows: the failing run's last log rows and the end of the app log, token scrubbed. */
async function failureReport() {
  try {
    if (sql) {
      const [run] = await sql`select id, status, stage from agent_runs order by id desc limit 1`;
      if (run) {
        say(`Last run: ${run.id} ${run.status}${run.stage ? ` in ${run.stage}` : ""}.`);
        const steps = await sql`select stage, round, tool, target, ok, summary from agent_run_steps where run_id = ${run.id} order by id`;
        for (const line of lastLogLines(steps)) say(`  log ${line}`);
      }
    }
  } catch {
    // The database may be what failed.
  }
  if (logFile && fs.existsSync(logFile)) {
    say("End of the app log:");
    for (const line of tailLines(fs.readFileSync(logFile, "utf8"), 40)) say(`  ${line}`);
  }
}

let code;
try {
  code = await main();
} catch (error) {
  if (error instanceof Refused) {
    warn(`Refused: ${error.message}`);
    code = 2;
  } else {
    warn(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof SmokeFailure)) warn(String(error instanceof Error ? error.stack : ""));
    await failureReport();
    code = 1;
  }
}
const clean = await cleanup();
process.exit(code === 0 && !clean ? 1 : code);
