import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { structuredReply } from "@/lib/agent-ai";
import { isSimulatedAgents } from "@/lib/agent-simulated";
import { checkAgentCanRun, logAgentActivity } from "@/lib/agents";
import { getAIKeys } from "@/lib/ai-keys";
import { inngest } from "@/lib/inngest/client";
import { librarianAccess, requestLibrarianRun, runLibrarian } from "@/lib/librarian-run";
import { MEMORY_LEARN, MEMORY_LEARN_AUTO, requestLearning } from "@/lib/librarian-request";
import { loadMemory } from "@/lib/memory";

// The database is a stand-in that records every query and answers by table; no model, GitHub or job runner is reached.
type Query = { op: string; table: string; fields: string[]; where: unknown[]; set: unknown[]; values: unknown[]; inTransaction: boolean };

const fake = vi.hoisted(() => ({
  queries: [] as Query[],
  answer: (_query: Query): unknown[] => [],
}));

vi.mock("@/db", async (importOriginal) => {
  const build = (op: string, inTransaction: boolean, fields: string[]) => {
    const entry: Query = { op, table: "", fields, where: [], set: [], values: [], inTransaction };
    fake.queries.push(entry);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, method) {
          if (method === "then") return (resolve: (rows: unknown[]) => void) => resolve(fake.answer(entry));
          return (argument: unknown) => {
            if (method === "from") entry.table = getTableName(argument as Table);
            if (method === "where") entry.where.push(argument);
            if (method === "set") entry.set.push(argument);
            if (method === "values") entry.values.push(argument);
            return chain;
          };
        },
      }
    );
    return { entry, chain };
  };
  const client = (inTransaction: boolean) => ({
    select: (fields?: object) => build("select", inTransaction, Object.keys(fields ?? {})).chain,
    insert: (table: Table) => {
      const { entry, chain } = build("insert", inTransaction, []);
      entry.table = getTableName(table);
      return chain;
    },
    update: (table: Table) => {
      const { entry, chain } = build("update", inTransaction, []);
      entry.table = getTableName(table);
      return chain;
    },
  });
  return {
    ...(await importOriginal<typeof import("@/db")>()),
    db: { ...client(false), transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client(true)) },
  };
});
vi.mock("@/lib/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents")>()),
  checkAgentCanRun: vi.fn(),
  logAgentActivity: vi.fn(async () => 77),
  updateAgentActivity: vi.fn(),
}));
vi.mock("@/lib/ai-keys", () => ({ getAIKeys: vi.fn() }));
vi.mock("@/lib/agent-ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/agent-ai")>()), structuredReply: vi.fn() }));
vi.mock("@/lib/agent-simulated", () => ({ isSimulatedAgents: vi.fn(() => false) }));
vi.mock("@/lib/memory", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/memory")>()), loadMemory: vi.fn() }));
vi.mock("@/lib/github", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/github")>()), getGithubToken: vi.fn(async () => "t") }));
// The real client would post to whatever Inngest Dev Server runs on this computer.
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));

const WORKSPACE = {
  id: 4242,
  ownerId: 9,
  name: "Acme",
  githubRepoFullName: "acme/app",
  githubDefaultBranch: "main",
  memoryMode: "local",
  memoryAutoLearn: true,
  memoryLibrarian: null,
};
const lead = { id: 5, key: "lead", model: "claude-sonnet-5-5" };
const signalRow = (id: number) => ({
  signal: { id, workspaceId: WORKSPACE.id, kind: "rework", trusted: false, payload: { text: `Lint failed ${id}.`, cause: "ci" }, taskId: 1, prNumber: 2, createdAt: new Date(2026, 0, id) },
  number: 1,
});

let unconsumed = 3;
function answers(workspace: object = WORKSPACE) {
  fake.answer = (query) => {
    if (query.op !== "select") return [];
    if (query.table === "workspaces") return [workspace];
    if (query.table === "memory_signals") return query.fields.includes("unconsumed") ? [{ unconsumed, trusted: 0 }] : [signalRow(1), signalRow(2), signalRow(3)];
    if (query.table === "memory_proposals") return query.fields.includes("pending") ? [{ pending: 0 }] : [];
    return [];
  };
}

const answer = (text: string, costMicros = 1234) => ({ text, refused: false, model: "claude-haiku-5-5", costMicros });
const PROPOSALS = JSON.stringify({
  proposals: [{ action: "add", scope: "project", target: null, note: { title: "Run lint", type: "pitfall", load: "on_demand", paths: [], body: "Lint first." }, rationale: "CI failed.", signal_ids: [1] }],
});

const writes = (table: string) => fake.queries.filter((query) => query.table === table && query.op !== "select");
/** The states written to workspaces.memory_librarian, in order. */
const states = () => writes("workspaces").flatMap((query) => query.set.map((set) => (set as { memoryLibrarian?: { state: string; message: string; costMicros: number } }).memoryLibrarian)).filter(Boolean);

beforeEach(() => {
  unconsumed = 3;
  answers();
  vi.mocked(checkAgentCanRun).mockResolvedValue({ ok: true, row: lead as never });
  vi.mocked(getAIKeys).mockResolvedValue({ openai: "o", anthropic: "a", openrouter: null });
  vi.mocked(isSimulatedAgents).mockReturnValue(false);
  vi.mocked(loadMemory).mockResolvedValue({ mode: "local", project: [], global: [], skipped: [], repoFound: false, problem: null });
  vi.mocked(structuredReply).mockResolvedValue(answer(PROPOSALS));
  vi.mocked(inngest.send).mockResolvedValue({ ids: [] });
});

afterEach(() => {
  fake.queries.length = 0;
  vi.clearAllMocks();
});

const learn = { workspaceId: WORKSPACE.id, job: "learn" as const, trigger: "manual" as const };

describe("who may run", () => {
  it("runs on the Lead's company first, else in the usual order", async () => {
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ok: true, leadId: 5, ai: { provider: "anthropic" } });
    vi.mocked(getAIKeys).mockResolvedValue({ openai: "o", anthropic: null, openrouter: null });
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ai: { provider: "openai" } });
  });

  it("says why it can't: memory off, Lead paused or out of budget, no API key", async () => {
    await expect(librarianAccess({ ...WORKSPACE, memoryMode: "off" })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("Memory is off") });
    vi.mocked(checkAgentCanRun).mockResolvedValue({ ok: false, reason: "paused", error: "" });
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("paused") });
    vi.mocked(checkAgentCanRun).mockResolvedValue({ ok: false, reason: "budget", error: "" });
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("budget") });
    vi.mocked(checkAgentCanRun).mockResolvedValue({ ok: true, row: lead as never });
    vi.mocked(getAIKeys).mockResolvedValue({ openai: null, anthropic: null, openrouter: null });
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("not your Claude plan") });
    vi.mocked(isSimulatedAgents).mockReturnValue(true);
    await expect(librarianAccess(WORKSPACE)).resolves.toMatchObject({ ok: true, ai: null });
  });

  it("a paused or spent Lead means no model call, no proposals and no signal used", async () => {
    for (const reason of ["paused", "budget"] as const) {
      fake.queries.length = 0;
      vi.mocked(checkAgentCanRun).mockResolvedValue({ ok: false, reason, error: "" });
      await expect(runLibrarian(learn)).resolves.toMatchObject({ state: "failed" });
      expect(structuredReply).not.toHaveBeenCalled();
      expect(writes("memory_signals")).toEqual([]);
      expect(writes("memory_proposals")).toEqual([]);
    }
  });
});

describe("a learning run", () => {
  it("asks the fast model, logs the cost on the Lead, and saves proposals with the signals used in one transaction", async () => {
    await expect(runLibrarian(learn)).resolves.toMatchObject({ state: "done", proposals: 1 });
    expect(structuredReply).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic" }), expect.objectContaining({ name: "memory_proposals" }), { job: "learn", tier: "fast" });
    expect(logAgentActivity).toHaveBeenCalledWith(expect.objectContaining({ agentId: 5, kind: "memory", costMicros: 1234 }));
    const [insert] = writes("memory_proposals");
    expect(insert).toMatchObject({ op: "insert", inTransaction: true, values: [[expect.objectContaining({ userId: 9, workspaceId: 4242, status: "pending", origin: "agent", untrustedOrigin: true })]] });
    const [consumed] = writes("memory_signals");
    expect(consumed).toMatchObject({ op: "update", inTransaction: true });
    const { sql, params } = new PgDialect().sqlToQuery(consumed!.where[0] as SQL);
    expect(sql).toContain("workspace_id");
    expect(sql).toContain("created_at");
    expect(params).toEqual(expect.arrayContaining([4242, 1, 2, 3]));
    expect(states().map((state) => state!.state)).toEqual(["running", "done"]);
    expect(states()[1]).toMatchObject({ costMicros: 1234 });
  });

  it("uses the signals up when the model proposed nothing", async () => {
    vi.mocked(structuredReply).mockResolvedValue(answer('{"proposals":[]}'));
    await expect(runLibrarian(learn)).resolves.toMatchObject({ state: "done", proposals: 0 });
    expect(writes("memory_signals")).toHaveLength(1);
    expect(writes("memory_proposals")).toEqual([]);
  });

  it("uses no signal up when the call fails, is refused or answers out of shape, and still logs what it cost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      () => vi.mocked(structuredReply).mockRejectedValueOnce(new Error("boom")),
      () => vi.mocked(structuredReply).mockResolvedValueOnce({ ...answer(""), text: null, refused: true }),
      () => vi.mocked(structuredReply).mockResolvedValueOnce(answer("not json")),
      () => vi.mocked(structuredReply).mockResolvedValueOnce(answer('{"other":1}')),
      () => vi.mocked(loadMemory).mockResolvedValueOnce({ mode: "repo", project: [], global: [], skipped: [], repoFound: false, problem: "unavailable" }),
    ];
    for (const fail of failures) {
      fake.queries.length = 0;
      fail();
      await expect(runLibrarian(learn)).resolves.toMatchObject({ state: "failed" });
      expect(writes("memory_signals")).toEqual([]);
      expect(writes("memory_proposals")).toEqual([]);
      expect(states().at(-1)).toMatchObject({ state: "failed" });
    }
    // The refused and the unreadable answers cost money all the same.
    expect(vi.mocked(logAgentActivity).mock.calls.filter(([entry]) => entry.costMicros === 1234)).toHaveLength(3);
  });

  it("an automatic request with nothing to do leaves no trace", async () => {
    unconsumed = 2;
    await expect(runLibrarian({ ...learn, trigger: "auto" })).resolves.toMatchObject({ skipped: expect.any(String) });
    expect(writes("workspaces")).toEqual([]);
    expect(structuredReply).not.toHaveBeenCalled();
  });

  it("reads only this workspace's signals", async () => {
    await runLibrarian(learn);
    for (const query of fake.queries.filter((q) => q.op === "select" && q.table === "memory_signals")) {
      expect(new PgDialect().sqlToQuery(query.where[0] as SQL).params).toContain(4242);
    }
    for (const query of fake.queries.filter((q) => q.op === "select" && q.table === "memory_proposals")) {
      const { params } = new PgDialect().sqlToQuery(query.where[0] as SQL);
      expect(params.includes(9) || params.includes(4242)).toBe(true);
    }
  });
});

describe("asking for a run", () => {
  it("Learn now queues the run and sends it at once", async () => {
    await expect(requestLibrarianRun(WORKSPACE as never, "learn")).resolves.toEqual({ ok: true });
    expect(inngest.send).toHaveBeenCalledWith({ name: MEMORY_LEARN, data: { workspaceId: 4242, job: "learn", trigger: "manual" } });
    expect(states().map((state) => state!.state)).toEqual(["queued"]);
  });

  it("refuses while one is busy or with nothing new, and reports a job runner that can't be reached", async () => {
    const busy = { ...WORKSPACE, memoryLibrarian: { state: "running", job: "learn", trigger: "manual", at: new Date().toISOString(), message: "", proposals: 0, costMicros: 0 } };
    await expect(requestLibrarianRun(busy as never, "learn")).resolves.toMatchObject({ ok: false });
    unconsumed = 0;
    await expect(requestLibrarianRun(WORKSPACE as never, "learn")).resolves.toMatchObject({ ok: false, message: expect.stringContaining("nothing new") });
    expect(inngest.send).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(requestLibrarianRun(WORKSPACE as never, "bootstrap")).resolves.toMatchObject({ ok: false, message: expect.stringContaining("Inngest") });
    expect(states().at(-1)).toMatchObject({ state: "failed" });
  });

  it("an automatic request never throws, and isn't sent with memory or automatic learning off", async () => {
    answers({ mode: "repo", autoLearn: true });
    await requestLearning(4242);
    expect(inngest.send).toHaveBeenCalledWith({ name: MEMORY_LEARN_AUTO, data: { workspaceId: 4242 } });
    vi.mocked(inngest.send).mockClear();
    for (const settings of [{ mode: "off", autoLearn: true }, { mode: "repo", autoLearn: false }]) {
      answers(settings);
      await requestLearning(4242);
    }
    expect(inngest.send).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    answers({ mode: "repo", autoLearn: true });
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("down"));
    await expect(requestLearning(4242)).resolves.toBeUndefined();
    fake.answer = () => {
      throw new Error("database down");
    };
    await expect(requestLearning(4242)).resolves.toBeUndefined();
  });
});
