import type { RunStatus } from "@/lib/agent-run-config";
import { ciForRound, type CiResult } from "@/lib/ci-gate";

/**
 * Metrics page math: how the agent pipeline performs over a period, from the runs started in it. Pure and
 * client-safe; lib/metrics.ts loads the rows.
 */

export const METRIC_PERIODS = [7, 30, 90] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

/** `?days=` on the Metrics page; anything else is the 30-day default. */
export function parsePeriod(raw: unknown): MetricPeriod {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return (METRIC_PERIODS as readonly number[]).includes(n) ? (n as MetricPeriod) : 30;
}

export const OUTCOMES = ["merged", "ready", "failed", "stopped", "needs_info", "running"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function outcomeOf(status: RunStatus): Outcome {
  switch (status) {
    case "completed":
      return "merged";
    case "awaiting_merge":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    case "needs_info":
      return "needs_info";
    case "queued":
    case "running":
      return "running";
  }
}

export const REWORK_CAUSES = ["ci", "lead", "tests"] as const;
export type ReworkCause = (typeof REWORK_CAUSES)[number];

export type MetricRun = {
  status: RunStatus;
  reworkRounds: number;
  costMicros: number;
  ci: CiResult[] | null;
  /** Rounds in which the Lead sent the work back (from the agent log). */
  leadSentBack: number[];
  /** Some stage ran on the owner's plan (a local CLI): its usage isn't in costMicros. */
  onPlan?: boolean;
};

export type RunMetrics = {
  runs: number;
  outcomes: Record<Outcome, number>;
  /** Merged or ready to merge. */
  delivered: number;
  /** Delivered out of the runs that ended delivered or failed (stops by the user and questions don't count). */
  successRate: number | null;
  /** Delivered without a single rework round. */
  firstPassRate: number | null;
  reworkCauses: Record<ReworkCause, number>;
  /** Pushes whose CI passed, out of those CI decided (passed or failed). */
  ciPassRate: number | null;
  ciDecided: number;
  /** API spend only: stages on the owner's plans spend nothing. */
  totalCostMicros: number;
  /** All API spend in the period divided by what was delivered: failed attempts are part of the price. */
  costPerDeliveredMicros: number | null;
  /** Runs with at least one stage on the owner's plan (their cost per card reads low on purpose). */
  planRuns: number;
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/**
 * Why a round went back to the Developer: its CI failed, else the Lead sent it back, else the tests failed (the only
 * three ways a rework round starts).
 */
export function reworkCause(run: Pick<MetricRun, "ci" | "leadSentBack">, round: number): ReworkCause {
  if (ciForRound(run.ci, round)?.state === "failed") return "ci";
  return run.leadSentBack.includes(round) ? "lead" : "tests";
}

export function summarizeRuns(runs: readonly MetricRun[]): RunMetrics {
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const reworkCauses = Object.fromEntries(REWORK_CAUSES.map((c) => [c, 0])) as Record<ReworkCause, number>;
  let firstPass = 0;
  let ciPassed = 0;
  let ciDecided = 0;
  let totalCostMicros = 0;
  let planRuns = 0;
  for (const run of runs) {
    const outcome = outcomeOf(run.status);
    outcomes[outcome]++;
    totalCostMicros += run.costMicros;
    if (run.onPlan) planRuns++;
    if ((outcome === "merged" || outcome === "ready") && run.reworkRounds === 0) firstPass++;
    for (let round = 0; round < run.reworkRounds; round++) reworkCauses[reworkCause(run, round)]++;
    for (const ci of run.ci ?? []) {
      if (ci.state !== "passed" && ci.state !== "failed") continue;
      ciDecided++;
      if (ci.state === "passed") ciPassed++;
    }
  }
  const delivered = outcomes.merged + outcomes.ready;
  return {
    runs: runs.length,
    outcomes,
    delivered,
    successRate: ratio(delivered, delivered + outcomes.failed),
    firstPassRate: ratio(firstPass, delivered),
    reworkCauses,
    ciPassRate: ratio(ciPassed, ciDecided),
    ciDecided,
    totalCostMicros,
    costPerDeliveredMicros: delivered > 0 ? Math.round(totalCostMicros / delivered) : null,
    planRuns,
  };
}

/** "67%", or "—" when there's nothing to measure yet. */
export function formatRate(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
