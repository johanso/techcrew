import { describe, expect, it } from "vitest";

import { CI_MAX_POLLS, ciForRound, ciSummary, classifyCi, failingChecks, logExcerpt, type CiResult } from "@/lib/ci-gate";
import type { CheckSummary } from "@/lib/github";

type Check = CheckSummary["checks"][number];
const check = (name: string, status: string, conclusion: string | null = null): Check => ({
  name,
  status,
  conclusion,
  url: null,
  id: 1,
  actions: true,
});
const summary = (...checks: Check[]): CheckSummary => ({ state: "success", checks });

describe("classifyCi", () => {
  it("waits a few polls for checks to appear when the repository has workflows", () => {
    expect(classifyCi({ head: summary(), poll: 1, hasWorkflows: true, baseFailing: null })).toEqual({ done: false });
    expect(classifyCi({ head: summary(), poll: 3, hasWorkflows: true, baseFailing: null })).toMatchObject({ done: true, state: "none" });
  });

  it("calls it none at once without workflows", () => {
    expect(classifyCi({ head: summary(), poll: 1, hasWorkflows: false, baseFailing: null })).toMatchObject({ done: true, state: "none" });
  });

  it("waits while any check runs, even when one already failed", () => {
    const head = summary(check("lint", "completed", "failure"), check("test", "in_progress"));
    expect(classifyCi({ head, poll: 2, hasWorkflows: true, baseFailing: null })).toEqual({ done: false });
  });

  it("times out at the poll limit with what failed so far", () => {
    const head = summary(check("lint", "completed", "failure"), check("e2e", "queued"));
    expect(classifyCi({ head, poll: CI_MAX_POLLS, hasWorkflows: true, baseFailing: null })).toMatchObject({
      done: true,
      state: "timed_out",
      failing: [{ name: "lint" }],
    });
  });

  it("passes when every check succeeded or was skipped", () => {
    const head = summary(check("lint", "completed", "success"), check("deploy", "completed", "skipped"), check("x", "completed", "neutral"));
    expect(classifyCi({ head, poll: 1, hasWorkflows: true, baseFailing: null })).toEqual({
      done: true,
      state: "passed",
      total: 3,
      failing: [],
      preexisting: [],
    });
  });

  it("fails on a check the change broke", () => {
    const head = summary(check("lint", "completed", "success"), check("test", "completed", "failure"));
    expect(classifyCi({ head, poll: 1, hasWorkflows: true, baseFailing: [] })).toMatchObject({ state: "failed", failing: [{ name: "test" }] });
  });

  it("doesn't blame the change for checks failing on the default branch too", () => {
    const head = summary(check("lint", "completed", "failure"), check("test", "completed", "success"));
    expect(classifyCi({ head, poll: 1, hasWorkflows: true, baseFailing: ["lint"] })).toMatchObject({
      state: "passed",
      failing: [],
      preexisting: ["lint"],
    });
  });

  it("counts timeouts, cancellations and commit-status errors as failures", () => {
    const failing = failingChecks(
      summary(check("a", "completed", "timed_out"), check("b", "completed", "cancelled"), check("c", "completed", "error"), check("d", "completed", "success"))
    );
    expect(failing.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });
});

describe("ciSummary and ciForRound", () => {
  const result = (round: number, state: CiResult["state"]): CiResult => ({ round, state, sha: "abc", total: 2, failing: [], preexisting: [] });

  it("reads like a sentence", () => {
    expect(ciSummary({ state: "passed", total: 1, failing: [], preexisting: [] })).toBe("CI passed: 1 check.");
    expect(ciSummary({ state: "failed", total: 2, failing: [{ name: "lint", conclusion: "failure", url: null, id: 1, actions: true }], preexisting: ["e2e"] })).toBe(
      "CI failed: lint (e2e also fail on the default branch)."
    );
    expect(ciSummary({ state: "none", total: 0, failing: [], preexisting: [] })).toBe("No CI checks on this repository.");
  });

  it("finds the latest result of a round", () => {
    const results = [result(0, "failed"), result(1, "waiting"), result(1, "passed")];
    expect(ciForRound(results, 1)?.state).toBe("passed");
    expect(ciForRound(results, 2)).toBeNull();
    expect(ciForRound(null, 0)).toBeNull();
  });
});

describe("logExcerpt", () => {
  it("keeps only the failing step's output up to the first error, without timestamps, colors or group markers", () => {
    const raw = [
      "2026-11-18T10:00:00.0000000Z ##[group]Run actions/checkout@v4",
      "2026-11-18T10:00:00.1000000Z [command]/usr/bin/git init",
      "2026-11-18T10:00:00.2000000Z ##[endgroup]",
      "2026-11-18T10:00:00.3000000Z ##[group]Run npm test",
      "2026-11-18T10:00:00.4000000Z \x1b[36;1mnpm test\x1b[0m",
      "2026-11-18T10:00:01.0000000Z > vitest run",
      "2026-11-18T10:00:02.0000000Z FAIL src/a.test.ts > adds",
      "2026-11-18T10:00:02.0000000Z ##[endgroup]",
      "2026-11-18T10:00:03.0000000Z ##[error]Process completed with exit code 1.",
      "2026-11-18T10:00:04.0000000Z Post job cleanup.",
    ].join("\n");
    expect(logExcerpt(raw)).toBe("Run npm test\nnpm test\n> vitest run\nFAIL src/a.test.ts > adds\n##[error]Process completed with exit code 1.");
  });

  it("falls back to the end of the log and caps its size", () => {
    const raw = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const excerpt = logExcerpt(raw);
    expect(excerpt.split("\n")).toHaveLength(60);
    expect(excerpt.endsWith("line 199")).toBe(true);
    expect(logExcerpt("x".repeat(10_000)).length).toBeLessThanOrEqual(4001);
  });
});
