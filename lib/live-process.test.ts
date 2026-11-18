import { describe, expect, it } from "vitest";

import { agentDoingSentence, liveProcessSteps, liveRunMeta, type LiveRun } from "@/lib/live-process";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 16, 12, 0, seconds));

function run(overrides: Partial<LiveRun> = {}): LiveRun {
  return {
    runId: 1,
    taskId: 7,
    key: "AJU-12",
    title: "Footer color in a CSS variable",
    type: "bug",
    status: "running",
    phase: "analysis",
    round: 0,
    startedAt: at(0),
    costMicros: 0,
    branch: null,
    pullRequest: null,
    brief: null,
    review: null,
    securityReport: null,
    approval: null,
    testReport: null,
    ci: null,
    stages: {},
    ...overrides,
  };
}

const states = (steps: ReturnType<typeof liveProcessSteps>) => steps.map((step) => step.state);

describe("liveProcessSteps", () => {
  it("idles all six steps with what each does when nothing runs", () => {
    const steps = liveProcessSteps(null, "auto_low_risk");
    expect(steps.map((s) => s.title)).toEqual(["Analysis", "Development", "Review", "Approval", "Testing", "Merge"]);
    expect(states(steps)).toEqual(Array(6).fill("idle"));
    expect(steps.every((s) => s.text.length > 0)).toBe(true);
    expect(steps[5]!.text).toMatch(/low risk merges itself/i);
    expect(steps[2]!.who).toBe("Reviewer + Security");
    expect(steps[5]!.who).toBe("Automatic");
  });

  it("shows every step up next while the run is queued", () => {
    expect(states(liveProcessSteps(run({ status: "queued", phase: null }), "manual"))).toEqual(Array(6).fill("pending"));
  });

  it("describes the working analyst from its latest action, with turns and cost", () => {
    const steps = liveProcessSteps(
      run({
        stages: {
          analysis: {
            turn: 3,
            maxTurns: 12,
            costMicros: 10_000,
            actions: [
              { tool: "read_file", target: "README.md", ok: true, at: at(1) },
              { tool: "search_code", target: "footer", ok: true, at: at(2) },
              { tool: "read_file", target: "src/styles.css", ok: true, at: at(3) },
            ],
            end: null,
          },
        },
      }),
      "manual"
    );
    expect(states(steps)).toEqual(["working", "pending", "pending", "pending", "pending", "pending"]);
    expect(steps[0]!.text).toBe("The Analyst is reading src/styles.css.");
    expect(steps[0]!.actions.map((a) => [a.label, a.target, a.agent])).toEqual([
      ["Read", "README.md", null],
      ["Searched", "footer", null],
      ["Read", "src/styles.css", null],
    ]);
    expect(steps[0]!.meta).toBe("Turn 3 of 12 · $0.01 so far");
  });

  it("follows both reviewers in parallel and says when one finished", () => {
    const base = run({
      phase: "review",
      branch: "agent/aju-12-footer",
      pullRequest: 11,
      brief: { decision: "ready", summary: "Move the color to --footer-bg.", acceptanceCriteria: [], plan: [], relevantFiles: [], developerNotes: "", question: "" },
    });
    const both = liveProcessSteps(
      {
        ...base,
        stages: {
          review: { turn: 1, maxTurns: 15, costMicros: 20_000, actions: [{ tool: "get_diff", target: null, ok: true, at: at(5) }], end: null },
          security: { turn: 1, maxTurns: 15, costMicros: 30_000, actions: [{ tool: "read_file", target: "index.html", ok: true, at: at(6) }], end: null },
        },
      },
      "manual"
    );
    expect(states(both)).toEqual(["done", "done", "working", "pending", "pending", "pending"]);
    expect(both[0]!.text).toBe("Brief ready: Move the color to --footer-bg.");
    expect(both[1]!.text).toBe("Pull request #11 is open on agent/aju-12-footer.");
    expect(both[2]!.people).toEqual([
      { agent: "reviewer", working: true },
      { agent: "security", working: true },
    ]);
    expect(both[2]!.text).toBe("The Reviewer is reading the diff of PR #11. Security is reading index.html.");
    expect(both[2]!.actions.map((a) => a.agent)).toEqual(["reviewer", "security"]);
    expect(both[2]!.meta).toBe("Reviewer turn 1 of 15 · Security turn 1 of 15 · $0.05 so far");

    const one = liveProcessSteps(
      {
        ...base,
        securityReport: { verdict: "pass", summary: "", findings: [] },
        stages: {
          review: { turn: 2, maxTurns: 15, costMicros: 0, actions: [], end: null },
          security: { turn: 2, maxTurns: 15, costMicros: 30_000, actions: [], end: { ok: true, summary: "No security issues" } },
        },
      },
      "manual"
    );
    expect(one[2]!.people.map((p) => p.working)).toEqual([true, false]);
    expect(one[2]!.text).toBe("The Reviewer is starting on PR #11. Security finished: no issues.");
  });

  it("shows results of finished steps and an agentless merge", () => {
    const steps = liveProcessSteps(
      run({
        phase: "merge",
        pullRequest: 11,
        review: { verdict: "approve", summary: "", findings: [] },
        securityReport: { verdict: "issues", summary: "", findings: [{ severity: "low", category: "other", path: "a", detail: "" }] },
        approval: { decision: "approve", risk: "low", riskReasons: [], summary: "", requiredChanges: [] },
        testReport: { verdict: "pass", summary: "", checks: [{ name: "a", passed: true, detail: "" }, { name: "b", passed: true, detail: "" }] },
      }),
      "auto_low_risk"
    );
    expect(states(steps)).toEqual(["done", "done", "done", "done", "done", "working"]);
    expect(steps[2]!.text).toBe("Reviewer approved · Security found 1 issue.");
    expect(steps[3]!.text).toBe("Approved · low risk.");
    expect(steps[4]!.text).toBe("Tests passed · 2 checks held.");
    expect(steps[5]).toMatchObject({ people: [], who: "Automatic", meta: "No model cost" });
    expect(steps[5]!.text).toMatch(/^Merging PR #11/);
  });
  it("holds the development step while the CI gate waits, then shows the CI result", () => {
    const ended = { turn: 6, maxTurns: 30, costMicros: 120_000, actions: [], end: { ok: true, summary: "Done." } };
    const ci = { round: 0, sha: "abc1234", total: 2, failing: [], preexisting: [] };
    const waiting = liveProcessSteps(
      run({ phase: "development", pullRequest: 12, stages: { development: ended }, ci: { ...ci, state: "waiting" } }),
      "manual"
    )[1]!;
    expect(waiting.state).toBe("working");
    expect(waiting.text).toBe("Waiting for CI on PR #12.");
    expect(waiting.people).toEqual([{ agent: "developer", working: false }]);
    expect(waiting.meta).toBe("No model cost");

    const passed = liveProcessSteps(run({ phase: "review", pullRequest: 12, ci: { ...ci, state: "passed" } }), "manual")[1]!;
    expect(passed.text).toBe("Pull request #12 is open. CI passed: 2 checks.");
  });
});

describe("agentDoingSentence", () => {
  it("falls back to the stage's job before the first tool call", () => {
    expect(agentDoingSentence("lead", run({ phase: "approval" }))).toBe("The Lead is combining both reviews and rating the risk.");
    expect(agentDoingSentence("developer", run({ phase: "development", branch: "agent/x" }))).toBe("The Developer is working on branch agent/x.");
  });
});

describe("liveRunMeta", () => {
  it("shows elapsed time, the step and the rework round", () => {
    expect(liveRunMeta(run({ phase: "review", round: 1 }), at(161))).toBe("Running 2:41 · step 3 of 6 · rework 1");
    expect(liveRunMeta(run({ status: "queued", phase: null }), at(5))).toBe("Queued for the agents");
  });
});
