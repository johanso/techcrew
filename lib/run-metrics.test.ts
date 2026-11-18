import { describe, expect, it } from "vitest";

import type { CiResult } from "@/lib/ci-gate";
import { formatRate, outcomeOf, parsePeriod, reworkCause, summarizeRuns, type MetricRun } from "@/lib/run-metrics";

const ci = (round: number, state: CiResult["state"]): CiResult => ({ round, state, sha: "abc", total: 1, failing: [], preexisting: [] });
const run = (overrides: Partial<MetricRun> = {}): MetricRun => ({
  status: "completed",
  reworkRounds: 0,
  costMicros: 100_000,
  ci: null,
  leadSentBack: [],
  ...overrides,
});

describe("parsePeriod", () => {
  it("accepts the offered periods and defaults to 30 days", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("14")).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
    expect(parsePeriod(["7"])).toBe(30);
  });
});

describe("outcomeOf", () => {
  it("maps run statuses to outcomes", () => {
    expect(outcomeOf("completed")).toBe("merged");
    expect(outcomeOf("awaiting_merge")).toBe("ready");
    expect(outcomeOf("cancelled")).toBe("stopped");
    expect(outcomeOf("queued")).toBe("running");
  });
});

describe("reworkCause", () => {
  it("blames CI first, then the Lead, then the tests", () => {
    const r = run({ reworkRounds: 3, ci: [ci(0, "failed"), ci(1, "passed"), ci(2, "passed")], leadSentBack: [1] });
    expect([0, 1, 2].map((round) => reworkCause(r, round))).toEqual(["ci", "lead", "tests"]);
  });
});

describe("summarizeRuns", () => {
  it("is empty-safe", () => {
    const m = summarizeRuns([]);
    expect(m.runs).toBe(0);
    expect(m.successRate).toBeNull();
    expect(m.firstPassRate).toBeNull();
    expect(m.ciPassRate).toBeNull();
    expect(m.costPerDeliveredMicros).toBeNull();
    expect(formatRate(m.successRate)).toBe("—");
  });

  it("counts outcomes, rates, rework causes and the full price of a delivered card", () => {
    const m = summarizeRuns([
      run({ ci: [ci(0, "passed")] }),
      run({ status: "awaiting_merge", reworkRounds: 1, ci: [ci(0, "failed"), ci(1, "passed")], costMicros: 300_000 }),
      run({ status: "failed", reworkRounds: 2, leadSentBack: [0, 1], costMicros: 500_000, ci: [ci(0, "none")] }),
      run({ status: "cancelled", costMicros: 50_000 }),
      run({ status: "needs_info", costMicros: 50_000 }),
    ]);
    expect(m.outcomes).toEqual({ merged: 1, ready: 1, failed: 1, stopped: 1, needs_info: 1, running: 0 });
    expect(m.delivered).toBe(2);
    expect(m.successRate).toBeCloseTo(2 / 3);
    expect(m.firstPassRate).toBe(0.5);
    expect(m.reworkCauses).toEqual({ ci: 1, lead: 2, tests: 0 });
    expect(m.ciDecided).toBe(3);
    expect(m.ciPassRate).toBeCloseTo(2 / 3);
    expect(m.totalCostMicros).toBe(1_000_000);
    expect(m.costPerDeliveredMicros).toBe(500_000);
    expect(formatRate(m.successRate)).toBe("67%");
  });
});
