import { afterEach, describe, expect, it, vi } from "vitest";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  answerRejection,
  askWhyRejected,
  deleteSignal,
  dismissRejection,
  getPendingRejections,
  listSignals,
  recordAnswerSignal,
  recordLessonSignals,
  recordReworkSignal,
  rememberNote,
} from "@/lib/memory-signals-store";

// A database that answers from a queue and keeps every condition, or fails like a lost connection.
const fake = vi.hoisted(() => ({
  queries: [] as { op: string; where: unknown[]; values: unknown[] }[],
  results: [] as unknown[][],
  failing: false,
}));

vi.mock("@/db", async (importOriginal) => {
  const query = (op: string) => {
    const entry = { op, where: [] as unknown[], values: [] as unknown[] };
    fake.queries.push(entry);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, method) {
          if (method === "then") {
            return (resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) =>
              fake.failing
                ? reject(new Error("Failed query: insert … params: THE-OWNERS-WORDS", { cause: new Error("connection refused") }))
                : resolve(fake.results.shift() ?? []);
          }
          return (argument: unknown) => {
            if (method === "where") entry.where.push(argument);
            if (method === "values") entry.values.push(argument);
            return chain;
          };
        },
      }
    );
    return chain;
  };
  return {
    ...(await importOriginal<typeof import("@/db")>()),
    db: { select: () => query("select"), insert: () => query("insert"), update: () => query("update"), delete: () => query("delete") },
  };
});

/** A recorded condition as SQL text and its parameters. */
const rendered = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);

afterEach(() => {
  fake.queries.length = 0;
  fake.results.length = 0;
  fake.failing = false;
  vi.restoreAllMocks();
});

describe("signals never throw into a run, a sync or an action", () => {
  it("answers with nothing done, warns once each and never logs the text", async () => {
    fake.failing = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordReworkSignal(1, 0, "lead")).resolves.toBe(false);
    await expect(recordAnswerSignal(1, "THE-OWNERS-WORDS")).resolves.toBe(false);
    await expect(recordLessonSignals(1, [{ title: "T", body: "B", type: "lesson", evidence: "" }])).resolves.toBe(0);
    await expect(askWhyRejected(1)).resolves.toBe(false);
    await expect(getPendingRejections(10)).resolves.toEqual(new Map());
    await expect(dismissRejection(10, 1)).resolves.toBe(false);
    await expect(answerRejection(10, 1, { reason: "other", note: "THE-OWNERS-WORDS" })).resolves.toMatchObject({ ok: false });
    await expect(rememberNote(10, { taskId: 1, stepId: null }, { text: "THE-OWNERS-WORDS", scope: "project" })).resolves.toMatchObject({ ok: false });
    expect(warn).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(warn.mock.calls)).toContain("connection refused");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("THE-OWNERS-WORDS");
  });

  it("records no lesson without asking the database", async () => {
    await expect(recordLessonSignals(1, [])).resolves.toBe(0);
    expect(fake.queries).toEqual([]);
  });
});

describe("isolation between workspaces", () => {
  const WORKSPACE = 4242;
  /** Every condition of the queries run so far names this workspace. */
  const expectScoped = () => {
    expect(fake.queries.length).toBeGreaterThan(0);
    for (const { where } of fake.queries) {
      expect(where).toHaveLength(1);
      const { sql, params } = rendered(where[0]);
      expect(sql).toContain("workspace_id");
      expect(params).toContain(WORKSPACE);
    }
  };

  it("lists, deletes, dismisses and answers only inside the owner's workspace", async () => {
    await listSignals({ id: WORKSPACE, name: "Acme" }, 20);
    await deleteSignal(WORKSPACE, 7);
    await dismissRejection(WORKSPACE, 7);
    await getPendingRejections(WORKSPACE);
    await answerRejection(WORKSPACE, 7, { reason: "other", note: "" });
    expectScoped();
  });

  it("another workspace's pull request or card is simply not there, and nothing is written", async () => {
    await expect(answerRejection(WORKSPACE, 7, { reason: "other", note: "" })).resolves.toMatchObject({ ok: false });
    await expect(rememberNote(WORKSPACE, { taskId: 7, stepId: 9 }, { text: "Note", scope: "project" })).resolves.toMatchObject({ ok: false });
    expectScoped();
    expect(fake.queries.map((query) => query.op)).toEqual(["select", "select"]);
  });

  it("a log entry must belong to the card and the workspace", async () => {
    fake.results.push([{ id: 7, title: "Card", githubIssueId: null, createdById: 1 }], []);
    await expect(rememberNote(WORKSPACE, { taskId: 7, stepId: 9 }, { text: "Note", scope: "project" })).resolves.toMatchObject({ ok: false });
    const step = rendered(fake.queries[1]!.where[0]);
    expect(step.params).toEqual(expect.arrayContaining([9, WORKSPACE, 7]));
    expect(fake.queries.map((query) => query.op)).toEqual(["select", "select"]);
  });

  it("refuses ids that aren't ids before any query", async () => {
    await expect(deleteSignal(WORKSPACE, Number.NaN)).resolves.toBe(false);
    await expect(dismissRejection(WORKSPACE, 1.5)).resolves.toBe(false);
    await expect(rememberNote(WORKSPACE, { taskId: Number.NaN, stepId: null }, { text: "Note", scope: "project" })).resolves.toMatchObject({ ok: false });
    expect(fake.queries).toEqual([]);
  });

  it("stores the owner's note under the card's workspace, trusted only when it is theirs", async () => {
    // A card from a GitHub issue, saved with its title unchanged.
    fake.results.push([{ id: 7, title: "Issue title", githubIssueId: 99, createdById: null }], [{ id: 1 }], [{ count: 1 }]);
    await expect(rememberNote(WORKSPACE, { taskId: 7, stepId: null }, { text: "Issue title", scope: "global" })).resolves.toEqual({ ok: true, trusted: false });
    expect(fake.queries[1]).toMatchObject({ op: "insert", values: [{ workspaceId: WORKSPACE, taskId: 7, kind: "remember", trusted: false }] });
  });
});
