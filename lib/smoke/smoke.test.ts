import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const testKey = vi.hoisted(() => Buffer.alloc(32, 3));
vi.mock("@/lib/secrets", () => ({ getEncryptionKey: () => testKey }));

import { AGENT_STAGES } from "@/lib/agent-run-config";
import { githubConnections, tasks, users, workspaces } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

import { parseSmokeArgs } from "./args.mjs";
import { planCleanup } from "./cleanup.mjs";
import { githubClient } from "./github.mjs";
import { checkRepoAccess, checkRepoGuard } from "./guard.mjs";
import { PIPELINE_STAGES, checkPipeline, decidePoll, describeChange, formatSummary, lastLogLines, stageRows, tailLines } from "./run.mjs";
import { encryptToken, seedDatabase } from "./seed.mjs";
import { SMOKE_DIST_DIR, smokePorts, stackEnv } from "./stack.mjs";
import { NO_TOKEN_MESSAGE, findGh, resolveToken, scrub } from "./token.mjs";

const TOKEN = "ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234";

describe("the repository guard", () => {
  it("needs a repository", () => {
    expect(checkRepoGuard({ repo: null, anyRepoName: false })).toMatchObject({ ok: false });
  });
  it("needs owner/name", () => {
    const out = checkRepoGuard({ repo: "just-a-name", anyRepoName: false });
    expect(out).toMatchObject({ ok: false });
  });
  it("accepts a name that says it is throwaway, whatever the case", () => {
    for (const name of ["acme/techteam-smoke", "acme/Throwaway-1", "acme/my-SCRATCH", "acme/scratch"]) {
      expect(checkRepoGuard({ repo: name, anyRepoName: false })).toEqual({ ok: true, repo: name });
    }
  });
  it("refuses a real-looking name, and the owner's name doesn't count", () => {
    expect(checkRepoGuard({ repo: "acme/website", anyRepoName: false })).toMatchObject({ ok: false });
    // A project's own demo repository is not throwaway just because it says sandbox.
    expect(checkRepoGuard({ repo: "acme/techteam-sandbox-demo", anyRepoName: false })).toMatchObject({ ok: false });
    expect(checkRepoGuard({ repo: "smoke-co/website", anyRepoName: false })).toMatchObject({ ok: false });
  });
  it("lets the override through, but still not a malformed name", () => {
    expect(checkRepoGuard({ repo: "acme/website", anyRepoName: true })).toEqual({ ok: true, repo: "acme/website" });
    expect(checkRepoGuard({ repo: "acme/web site", anyRepoName: true })).toMatchObject({ ok: false });
  });
  it("needs push access to a repository that isn't archived", () => {
    expect(checkRepoAccess({ full_name: "a/smoke", permissions: { push: true } })).toEqual({ ok: true });
    expect(checkRepoAccess({ full_name: "a/smoke", permissions: { push: false } })).toMatchObject({ ok: false });
    expect(checkRepoAccess({ full_name: "a/smoke" })).toMatchObject({ ok: false });
    expect(checkRepoAccess({ full_name: "a/smoke", archived: true, permissions: { push: true } })).toMatchObject({ ok: false });
  });
});

describe("the command line", () => {
  it("reads the options and SMOKE_REPO", () => {
    expect(parseSmokeArgs(["--keep", "--timeout", "5"], { SMOKE_REPO: "a/smoke" })).toEqual({
      ok: true,
      options: { repo: "a/smoke", keep: true, timeoutMinutes: 5, reuseBuild: false, anyRepoName: false },
    });
    expect(parseSmokeArgs(["--repo", "b/smoke"], { SMOKE_REPO: "a/smoke" })).toMatchObject({ options: { repo: "b/smoke", timeoutMinutes: 12 } });
  });
  it("refuses unknown options and bad values", () => {
    expect(parseSmokeArgs(["--force"], {})).toMatchObject({ ok: false });
    expect(parseSmokeArgs(["--timeout", "0"], {})).toMatchObject({ ok: false });
    expect(parseSmokeArgs(["--repo"], {})).toMatchObject({ ok: false });
  });
});

describe("the token", () => {
  const readGh = (stdout: string, status = 0) => () => ({ status, stdout });
  it("prefers SMOKE_GITHUB_TOKEN over the GitHub CLI", () => {
    expect(resolveToken({ env: { SMOKE_GITHUB_TOKEN: ` ${TOKEN} ` }, ghPath: "gh", readGh: readGh("other") })).toEqual({ ok: true, token: TOKEN, source: "env" });
  });
  it("falls back to `gh auth token`", () => {
    expect(resolveToken({ env: {}, ghPath: "gh", readGh: readGh(`${TOKEN}\n`) })).toEqual({ ok: true, token: TOKEN, source: "gh" });
  });
  it("says what to do when there is none", () => {
    const noGh = resolveToken({ env: {}, ghPath: null, readGh: readGh("") });
    expect(noGh).toMatchObject({ ok: false });
    expect(JSON.stringify(noGh)).toContain(NO_TOKEN_MESSAGE);
    expect(resolveToken({ env: {}, ghPath: "gh", readGh: readGh("", 1) })).toMatchObject({ ok: false });
    expect(resolveToken({ env: { SMOKE_GITHUB_TOKEN: "   " }, ghPath: "gh", readGh: readGh("") })).toMatchObject({ ok: false });
  });
  it("finds the GitHub CLI on PATH or in its install folder", () => {
    const exists = (file: string) => file === "C:\\Program Files\\GitHub CLI\\gh.exe";
    expect(findGh({ PATH: "C:\\bin" }, exists, "win32")).toBe("C:\\Program Files\\GitHub CLI\\gh.exe");
    expect(findGh({ PATH: "C:\\other" }, (file) => file === "C:\\other\\gh.exe", "win32")).toBe("C:\\other\\gh.exe");
    expect(findGh({ PATH: "/bin" }, () => false, "linux")).toBeNull();
  });
});

describe("the run's outcome", () => {
  const time = { elapsedMs: 1000, timeoutMs: 60_000 };
  it("waits while the run is in flight", () => {
    expect(decidePoll({ status: "running" }, time)).toEqual({ action: "wait" });
    expect(decidePoll({ status: "queued" }, time)).toEqual({ action: "wait" });
  });
  it("is done at awaiting_merge", () => {
    expect(decidePoll({ status: "awaiting_merge" }, time)).toEqual({ action: "done" });
  });
  it("fails for failed, needs_info, cancelled, completed and a missing run", () => {
    expect(decidePoll({ status: "failed", error: "boom" }, time)).toMatchObject({ action: "fail", reason: expect.stringContaining("boom") });
    expect(decidePoll({ status: "needs_info" }, time)).toMatchObject({ action: "fail" });
    expect(decidePoll({ status: "cancelled" }, time)).toMatchObject({ action: "fail" });
    expect(decidePoll({ status: "completed" }, time)).toMatchObject({ action: "fail" });
    expect(decidePoll(null, time)).toMatchObject({ action: "fail" });
  });
  it("times out, naming the stage it was in", () => {
    expect(decidePoll({ status: "running", stage: "review" }, { elapsedMs: 61_000, timeoutMs: 60_000 })).toMatchObject({ action: "fail", reason: expect.stringContaining("review") });
  });
  it("describes only changes", () => {
    expect(describeChange(null, { status: "queued" })).toBe("run queued");
    expect(describeChange({ status: "running", stage: "analysis" }, { status: "running", stage: "analysis" })).toBeNull();
    expect(describeChange({ status: "running", stage: "analysis" }, { status: "running", stage: "development" })).toBe("run running · development");
  });
});

const step = (stage: string, over: Partial<{ tool: string; ok: boolean; summary: string; createdAt: string }> = {}) => ({
  stage,
  round: 0,
  turn: 0,
  seq: 0,
  tool: "list_files",
  target: null,
  ok: true,
  summary: null,
  createdAt: "2026-11-24T10:00:10Z",
  ...over,
});

describe("the pipeline check", () => {
  it("covers the stages the app defines", () => {
    expect([...PIPELINE_STAGES]).toEqual([...AGENT_STAGES]);
  });
  const all = PIPELINE_STAGES.map((stage) => step(stage));
  it("passes when every stage has a row and none failed", () => {
    expect(checkPipeline(all)).toEqual({ ok: true });
  });
  it("names a stage that never ran", () => {
    const out = checkPipeline(all.filter((row) => row.stage !== "security"));
    expect(out).toMatchObject({ ok: false, problems: [expect.stringContaining("security")] });
  });
  it("names a failed or stopped row", () => {
    expect(checkPipeline([...all, step("testing", { ok: false, summary: "no" })])).toMatchObject({ ok: false });
    expect(checkPipeline([...all, step("review", { tool: "stopped" })])).toMatchObject({ ok: false });
  });
});

describe("the summary", () => {
  it("measures stages and formats a table", () => {
    const rows = stageRows(
      [step("analysis", { createdAt: "2026-11-24T10:00:08Z" }), step("analysis", { createdAt: "2026-11-24T10:00:20Z" }), step("development", { createdAt: "2026-11-24T10:00:25Z" }), step("development", { createdAt: "2026-11-24T10:01:25Z" })],
      "2026-11-24T10:00:00Z"
    );
    expect(rows[0]).toEqual({ stage: "analysis", steps: 2, status: "ok", seconds: 20 });
    expect(rows[1]).toMatchObject({ stage: "development", seconds: 60 });
    expect(rows[2]).toMatchObject({ stage: "review", status: "missing", steps: 0 });
    const text = formatSummary(rows, { totalSeconds: 275, outcome: "PASSED", pullRequest: 4, branch: "agent/smk-1-x" });
    expect(text).toContain("analysis");
    expect(text).toContain("total 4m 35s · PASSED · PR #4 · agent/smk-1-x");
  });
  it("shows the last log rows as stored and the tail of a log", () => {
    const lines = lastLogLines([step("analysis"), step("development", { ok: false, summary: "No access" })], 5);
    expect(lines[1]).toBe("FAIL development/0 list_files — No access");
    expect(tailLines("a\nb\n\nc\n", 2)).toEqual(["b", "c"]);
  });
});

describe("the GitHub cleanup plan", () => {
  const base = { defaultBranch: "master", before: ["agent/old-1"], openPulls: [] as { number: number; head: string }[] };
  it("deletes only agent/* branches that appeared during the run", () => {
    const plan = planCleanup({ ...base, after: ["agent/old-1", "agent/smk-1-a", "agent/smk-2-b"], openPulls: [{ number: 5, head: "agent/smk-1-a" }, { number: 2, head: "agent/old-1" }] });
    expect(plan).toEqual({ closePulls: [5], deleteBranches: ["agent/smk-1-a", "agent/smk-2-b"] });
  });
  it("never names the default branch or a branch outside agent/", () => {
    const plan = planCleanup({ ...base, defaultBranch: "agent/main", after: ["agent/main", "master", "feature/x", "agent/new"], openPulls: [{ number: 1, head: "feature/x" }] });
    expect(plan).toEqual({ closePulls: [], deleteBranches: ["agent/new"] });
  });
  it("does nothing when nothing was created", () => {
    expect(planCleanup({ ...base, after: ["agent/old-1"] })).toEqual({ closePulls: [], deleteBranches: [] });
  });
});

describe("the stack", () => {
  const config = { ports: smokePorts({}), dataDir: "/tmp/smoke-data" };
  it("uses spare ports unless told otherwise", () => {
    expect(smokePorts({})).toEqual({ app: 3992, inngest: 8294, pg: 54794 });
    expect(smokePorts({ SMOKE_APP_PORT: "4100", SMOKE_PG_PORT: "nope" })).toEqual({ app: 4100, inngest: 8294, pg: 54794 });
  });
  it("is simulated, local to the temp folder and cut off from the owner's settings", () => {
    const env = stackEnv(
      { PATH: "/bin", DATABASE_URL: "postgres://owner", TECHTEAM_PORT: "3000", SMOKE_GITHUB_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN, OPENAI_API_KEY: "sk-x", SANDBOX_DOCKER_HOST: "ssh://x" },
      config
    );
    expect(env.PATH).toBe("/bin");
    expect(env).toMatchObject({
      DATABASE_URL: "",
      TOKEN_ENCRYPTION_KEY: "",
      OPENAI_API_KEY: "",
      SANDBOX_DOCKER_HOST: "",
      AGENTS_SIMULATED: "true",
      AGENTS_AUTO_PICKUP: "false",
      TECHTEAM_SANDBOX: "off",
      TECHTEAM_DATA_DIR: "/tmp/smoke-data",
      TECHTEAM_PORT: "3992",
      TECHTEAM_DIST_DIR: SMOKE_DIST_DIR,
    });
    expect(JSON.stringify(env)).not.toContain(TOKEN);
    expect(Object.keys(env)).not.toContain("SMOKE_GITHUB_TOKEN");
  });
});

describe("the seed", () => {
  const key = testKey;
  it("encrypts the way lib/crypto.ts reads", () => {
    const sealed = encryptToken(TOKEN, key);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain(TOKEN);
    expect(decrypt(sealed)).toBe(TOKEN);
  });
  it("sends the plain token nowhere", async () => {
    const calls: unknown[][] = [];
    const tx = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push([strings.join("?"), ...values]);
        return Promise.resolve([{ id: 1 }]);
      },
      {}
    );
    const sql = { begin: (work: (t: typeof tx) => unknown) => work(tx) };
    const encryptedToken = encryptToken(TOKEN, key);
    await seedDatabase(sql as never, { github: { id: 7, login: "me", avatarUrl: null }, encryptedToken, repo: { id: 1, fullName: "me/smoke", htmlUrl: "https://github.com/me/smoke", defaultBranch: "master", private: true } });
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(JSON.stringify(calls)).toContain(encryptedToken);
    expect(calls).toHaveLength(4);
  });
});

describe("the seed against the schema", () => {
  it("only inserts columns db/schema.ts defines", async () => {
    const statements: string[] = [];
    const tx = (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return Promise.resolve([{ id: 1 }]);
    };
    const sql = { begin: (work: (t: typeof tx) => unknown) => work(tx) };
    await seedDatabase(sql as never, { github: { id: 7, login: "me", avatarUrl: null }, encryptedToken: "v1.a.b.c", repo: { id: 1, fullName: "me/smoke", htmlUrl: "u", defaultBranch: "master", private: true } });
    const tables = { users, github_connections: githubConnections, workspaces, tasks };
    const seen = new Set<string>();
    for (const statement of statements) {
      const match = /insert into (\w+) \(([^)]*)\)/.exec(statement);
      expect(match).not.toBeNull();
      const [, table, list] = match!;
      seen.add(table);
      const known = Object.values(getTableColumns(tables[table as keyof typeof tables])).map((column) => column.name);
      for (const column of list.split(",").map((name) => name.trim())) expect(known, `${table}.${column}`).toContain(column);
    }
    expect([...seen].sort()).toEqual(["github_connections", "tasks", "users", "workspaces"]);
  });
});

describe("no token in any output", () => {
  it("scrubs a known token and anything shaped like one", () => {
    expect(scrub(`x ${TOKEN} y ghs_${"A".repeat(30)} github_pat_${"b".repeat(30)}`, [TOKEN])).toBe("x *** y *** ***");
    expect(scrub("short", ["abc"])).toBe("short");
  });
  it("never reaches a message, a summary, a log line or an argument list", () => {
    const strings: string[] = [];
    strings.push(
      JSON.stringify(checkRepoGuard({ repo: "acme/website", anyRepoName: false })),
      JSON.stringify(checkRepoAccess({ full_name: "acme/smoke", permissions: { push: false } })),
      JSON.stringify(resolveToken({ env: {}, ghPath: "gh", readGh: () => ({ status: 1, stdout: TOKEN }) })),
      JSON.stringify(resolveToken({ env: { SMOKE_GITHUB_TOKEN: `${TOKEN} x` }, ghPath: null, readGh: () => ({ status: 0, stdout: "" }) })),
      JSON.stringify(parseSmokeArgs(["--repo", "acme/smoke", "--oops"], { SMOKE_GITHUB_TOKEN: TOKEN })),
      formatSummary(stageRows([step("analysis")], "2026-11-24T10:00:00Z"), { totalSeconds: 1, outcome: "FAILED" }),
      JSON.stringify(decidePoll({ status: "failed", error: "boom" }, { elapsedMs: 0, timeoutMs: 1 })),
      ...lastLogLines([step("analysis", { summary: "ok" })]),
      JSON.stringify(stackEnv({ SMOKE_GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN, PATH: "p" }, { ports: smokePorts({}), dataDir: "d" })),
      JSON.stringify(planCleanup({ defaultBranch: "m", before: [], after: ["agent/x"], openPulls: [] }))
    );
    for (const text of strings) expect(text).not.toContain(TOKEN);
  });
  it("only sends the token in the Authorization header, and errors don't carry it", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const client = githubClient(TOKEN, fakeFetch);
    const error = await client.user().catch((e: Error) => e);
    expect((error as Error).message).not.toContain(TOKEN);
    expect(seen[0]!.url).not.toContain(TOKEN);
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(Object.entries(seen[0]!.headers).filter(([, value]) => value.includes(TOKEN)).map(([name]) => name)).toEqual(["Authorization"]);
  });
});
