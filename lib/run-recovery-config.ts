import type { RunStatus } from "@/lib/agent-run-config";

/**
 * Runs interrupted when TechTeam stopped (docs/background-jobs.md). Pure and client-safe: the sweeper's rules and the
 * words the owner reads, tested without a database.
 */

/** A run with no sign of life for this long, and nothing it waits for, was left behind by a stopped TechTeam. */
export const STALE_RUN_MS = 30 * 60_000;

export type SweepableRun = { status: RunStatus | string; waiting: unknown; updatedAt: Date };

/**
 * Whether a run was abandoned: queued or running, not paused on purpose (`waiting` is the owner's plan reset), and
 * its latest sign of life (the run's own update, its newest log step, its card's newest agent activity) is older than
 * STALE_RUN_MS. Every other status is waiting on a person or is over, and is never touched.
 */
export function isStaleRun(run: SweepableRun, lastActivityAt: Date | null, now: Date) {
  if (run.status !== "queued" && run.status !== "running") return false;
  if (run.waiting !== null && run.waiting !== undefined) return false;
  const lastSeen = Math.max(run.updatedAt.getTime(), lastActivityAt?.getTime() ?? 0);
  return now.getTime() - lastSeen > STALE_RUN_MS;
}

/** The latest of several optional times, or null when there are none. */
export function latestOf(...times: (Date | null | undefined)[]) {
  const set = times.filter((time): time is Date => time instanceof Date);
  return set.length ? new Date(Math.max(...set.map((time) => time.getTime()))) : null;
}

/** The card's status line for a run that was left behind. */
export const INTERRUPTED_LABEL = "Interrupted when TechTeam stopped";

/** What the owner is told when a run was left behind: the bell's title and text (also the run's error). */
export function interruptedNotice(key: string) {
  return {
    title: `Run interrupted on ${key}`,
    body: `The run on ${key} was interrupted when TechTeam stopped. Press Run to continue: it picks up the same branch.`,
  };
}
