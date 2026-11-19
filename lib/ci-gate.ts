import type { CheckSummary } from "@/lib/github";

/**
 * The CI gate between development and review: after the Developer pushes, the pipeline waits for the pull request's
 * checks. A failure the change caused goes back to the Developer with the failing output, before anyone reviews it.
 * Pure and client-safe; the polling lives in lib/agent-pipeline.ts and lib/inngest/agent-run.ts.
 */

export const CI_STATES = ["waiting", "passed", "failed", "none", "timed_out"] as const;
/** waiting: checks running · passed · failed: a check the change broke · none: no CI · timed_out: still running at the limit. */
export type CiState = (typeof CI_STATES)[number];

export type CiCheck = { name: string; conclusion: string | null; url: string | null; id: number | null; actions: boolean };

/** One round's CI on the run's pull request (stored in `agent_runs.ci`, one entry per development round). */
export type CiResult = {
  round: number;
  state: CiState;
  /** The commit the checks ran on. */
  sha: string;
  /** Checks reported on the commit. */
  total: number;
  /** Failing checks the change caused: the Developer gets these back. */
  failing: CiCheck[];
  /** Checks that fail on the default branch too: not this change's fault, so they don't block. */
  preexisting: string[];
};

/** Seconds between polls. */
export const CI_POLL_SECONDS = 30;
/** Give up waiting after this many polls (15 minutes): review starts and the merge waits for CI instead. */
export const CI_MAX_POLLS = 30;
/** With workflows in the repo but no check reported yet, wait this many polls for one to appear before calling it "none". */
const CI_NO_CHECKS_POLLS = 3;

const FAILED_CONCLUSIONS = new Set(["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** Completed checks that failed. */
export function failingChecks(summary: CheckSummary): CiCheck[] {
  return summary.checks
    .filter((c) => c.status === "completed" && FAILED_CONCLUSIONS.has(c.conclusion ?? ""))
    .map((c) => ({ name: c.name, conclusion: c.conclusion, url: c.url, id: c.id, actions: c.actions }));
}

export type CiVerdict = { done: false } | { done: true; state: Exclude<CiState, "waiting">; total: number; failing: CiCheck[]; preexisting: string[] };

/**
 * What one poll means. `poll` counts from 1. `hasWorkflows` (null = unknown) lets a repository without Actions skip
 * the wait at once; `baseFailing` are the checks failing on the default branch's head (null when not fetched).
 * The gate waits until every check has finished, so the Developer gets every failure in one round.
 */
export function classifyCi(input: { head: CheckSummary; poll: number; hasWorkflows: boolean | null; baseFailing: string[] | null }): CiVerdict {
  const { head, poll } = input;
  const total = head.checks.length;
  if (!total) {
    const none = input.hasWorkflows === false || poll >= CI_NO_CHECKS_POLLS;
    return none ? { done: true, state: "none", total, failing: [], preexisting: [] } : { done: false };
  }
  const failing = failingChecks(head);
  const base = new Set(input.baseFailing ?? []);
  const blocking = failing.filter((c) => !base.has(c.name));
  const preexisting = failing.filter((c) => base.has(c.name)).map((c) => c.name);
  if (head.checks.some((c) => c.status !== "completed")) {
    return poll >= CI_MAX_POLLS ? { done: true, state: "timed_out", total, failing: blocking, preexisting } : { done: false };
  }
  return { done: true, state: blocking.length ? "failed" : "passed", total, failing: blocking, preexisting };
}

/** "3 checks passed", "lint failed", "no CI configured" … for logs, prompts and the UI. */
export function ciSummary(result: Pick<CiResult, "state" | "total" | "failing" | "preexisting">) {
  const checks = `${result.total} check${result.total === 1 ? "" : "s"}`;
  const preexisting = result.preexisting.length ? ` (${result.preexisting.join(", ")} also fail on the default branch)` : "";
  switch (result.state) {
    case "waiting":
      return "Waiting for CI.";
    case "passed":
      return `CI passed: ${checks}${preexisting}.`;
    case "failed":
      return `CI failed: ${result.failing.map((c) => c.name).join(", ")}${preexisting}.`;
    case "none":
      return "No CI checks on this repository.";
    case "timed_out":
      return `CI was still running after ${(CI_MAX_POLLS * CI_POLL_SECONDS) / 60} minutes; the merge waits for it.`;
  }
}

/** The latest CI result of a round, if any. */
export function ciForRound(results: readonly CiResult[] | null | undefined, round: number): CiResult | null {
  return results?.findLast((r) => r.round === round) ?? null;
}

// Timestamps GitHub prefixes to every log line, and terminal colors.
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z /;
const LOG_ANSI = /\x1b\[[0-9;]*m/g;
const LOG_LINES = 60;
const LOG_CHARS = 4000;

/**
 * The part of a job log that explains a failure: the failing step's output, from its "Run …" header to the first
 * `##[error]` (else the end of the log), so the checkout and setup noise before it stays out. Timestamps, colors and
 * group markers are stripped; at most LOG_LINES lines and LOG_CHARS characters, keeping the end.
 */
export function logExcerpt(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(LOG_TIMESTAMP, "").replace(LOG_ANSI, ""))
    .filter((line) => line.trim() && !line.startsWith("##[endgroup]"));
  const error = lines.findIndex((line) => line.startsWith("##[error]"));
  const end = error === -1 ? lines.length : error + 1;
  let start = end - 1;
  while (start > 0 && !lines[start]!.startsWith("##[group]Run ")) start--;
  const excerpt = lines
    .slice(Math.max(start, end - LOG_LINES), end)
    .map((line) => line.replace(/^##\[group\]/, ""))
    .join("\n");
  return excerpt.length > LOG_CHARS ? `…${excerpt.slice(-LOG_CHARS)}` : excerpt;
}
