import { describe, expect, it } from "vitest";

import { TURNS_LEFT_NOTICE_AT, cliChunkPrompt, continuableBranch, lastTurnMessage, outOfTurnsOutcome, turnsLeftNotice, type OutOfTurnsFacts } from "@/lib/agent-turns";

const facts = (over: Partial<OutOfTurnsFacts>): OutOfTurnsFacts => ({
  stage: "development",
  maxTurns: 40,
  aheadBy: 7,
  headSha: "bbb",
  previousRoundSha: null,
  changedFiles: ["src/split.ts", "src/split.test.ts"],
  taskTitle: "Split by items",
  ...over,
});

describe("turnsLeftNotice", () => {
  it("warns once, when the next turns are the last few", () => {
    expect(turnsLeftNotice(40 - TURNS_LEFT_NOTICE_AT, 40, "submit_work")).toMatch(/^3 turns left, the last one only for submit_work/);
    expect(turnsLeftNotice(36, 40, "submit_work")).toBeNull();
    expect(turnsLeftNotice(38, 40, "submit_work")).toBeNull();
  });

  it("stays quiet on short stages", () => {
    expect(turnsLeftNotice(2, 5, "submit_review")).toBeNull();
  });
});

describe("lastTurnMessage", () => {
  it("tells the Developer to submit unfinished work with what's left", () => {
    const message = lastTurnMessage("submit_work");
    expect(message).toContain("complete: false");
    expect(message).toContain("remaining_work");
  });

  it("tells other stages to finish with what they checked", () => {
    expect(lastTurnMessage("submit_review")).toMatch(/^This is your last turn\. Call submit_review now/);
  });
});

describe("outOfTurnsOutcome", () => {
  it("continues the Developer's committed work as unfinished, with the measured files", () => {
    const outcome = outOfTurnsOutcome(facts({}));
    expect(outcome.kind).toBe("continue");
    if (outcome.kind !== "continue") return;
    expect(outcome.result).toMatchObject({ complete: false, outOfTurns: true, changedFiles: ["src/split.ts", "src/split.test.ts"], pullRequestTitle: "Split by items" });
  });

  it("stops when the branch has nothing, or a rework round committed nothing new", () => {
    expect(outOfTurnsOutcome(facts({ aheadBy: 0 }))).toMatchObject({ kind: "stop", reason: expect.stringContaining("without a result or a commit") });
    expect(outOfTurnsOutcome(facts({ aheadBy: null }))).toMatchObject({ kind: "stop" });
    expect(outOfTurnsOutcome(facts({ headSha: "aaa", previousRoundSha: "aaa" }))).toMatchObject({ kind: "stop", reason: expect.stringContaining("rework round") });
    expect(outOfTurnsOutcome(facts({ headSha: "bbb", previousRoundSha: "aaa" })).kind).toBe("continue");
  });

  it("turns a missing review or security report into a failed check for the Lead", () => {
    expect(outOfTurnsOutcome(facts({ stage: "review" }))).toMatchObject({ kind: "continue", result: { verdict: "request_changes", findings: [], incomplete: true } });
    expect(outOfTurnsOutcome(facts({ stage: "security" }))).toMatchObject({ kind: "continue", result: { verdict: "issues", findings: [], incomplete: true } });
  });

  it("stops the run without the Analyst's, the Lead's or the Tester's decision", () => {
    for (const stage of ["analysis", "approval", "testing"] as const) {
      expect(outOfTurnsOutcome(facts({ stage })).kind, stage).toBe("stop");
    }
  });
});

describe("continuableBranch", () => {
  it("continues the newest earlier run's branch when it stopped without a pull request", () => {
    expect(continuableBranch({ branch: "agent/san-6-split", status: "failed" }, [])).toBe("agent/san-6-split");
    expect(continuableBranch({ branch: "agent/san-6-split", status: "cancelled" }, ["agent/other"])).toBe("agent/san-6-split");
  });

  it("starts over otherwise", () => {
    expect(continuableBranch(null, [])).toBeNull();
    expect(continuableBranch({ branch: null, status: "failed" }, [])).toBeNull();
    expect(continuableBranch({ branch: "agent/san-6-split", status: "failed" }, ["agent/san-6-split"])).toBeNull();
    expect(continuableBranch({ branch: "agent/san-6-split", status: "completed" }, [])).toBeNull();
  });
});

describe("cliChunkPrompt", () => {
  it("opens with the brief, then nudges", () => {
    expect(cliChunkPrompt({ brief: "<task>…</task>", remaining: 40, chunkTurns: 10, finish: "submit_work" })).toBe("<task>…</task>");
    expect(cliChunkPrompt({ brief: null, remaining: 30, chunkTurns: 10, finish: "submit_work" })).toMatch(/^Continue working/);
  });

  it("warns in the chunk that reaches the limit", () => {
    const prompt = cliChunkPrompt({ brief: null, remaining: 6, chunkTurns: 6, finish: "submit_work" });
    expect(prompt).toContain("You have 6 turns left");
    expect(prompt).toContain("complete: false");
    expect(cliChunkPrompt({ brief: null, remaining: 4, chunkTurns: 4, finish: "submit_review" })).toContain("what you left unchecked");
  });

  it("asks for the finish tool alone on the last turn", () => {
    expect(cliChunkPrompt({ brief: null, remaining: 1, chunkTurns: 1, finish: "submit_test_report" })).toContain(lastTurnMessage("submit_test_report"));
  });
});
