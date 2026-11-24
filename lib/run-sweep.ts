import "server-only";

import { and, eq, inArray, isNull, lt, max } from "drizzle-orm";

import { agentActivity, agentRunSteps, agentRuns, db } from "@/db";
import { ACTIVE_RUN_STATUSES } from "@/lib/agent-run-config";
import { stopInterruptedRun } from "@/lib/agent-pipeline";
import { STALE_RUN_MS, isStaleRun, latestOf } from "@/lib/run-recovery-config";

/**
 * Ends the runs a stopped TechTeam left behind (docs/background-jobs.md): queued or running with nothing to wait for
 * and no sign of life for STALE_RUN_MS. Safe to run twice or on two computers at once: each run is ended by one
 * conditional update. Returns the ids it ended.
 */
export async function sweepStaleRuns(now: Date = new Date()) {
  const idleBefore = new Date(now.getTime() - STALE_RUN_MS);
  // The run's own update is the cheap first cut; its log and its card's activity can still show life.
  const candidates = await db
    .select({ id: agentRuns.id, taskId: agentRuns.taskId, status: agentRuns.status, waiting: agentRuns.waiting, updatedAt: agentRuns.updatedAt })
    .from(agentRuns)
    .where(and(inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]), isNull(agentRuns.waiting), lt(agentRuns.updatedAt, idleBefore)));

  const ended: number[] = [];
  for (const run of candidates) {
    const [[step], [activity]] = await Promise.all([
      db.select({ at: max(agentRunSteps.createdAt) }).from(agentRunSteps).where(eq(agentRunSteps.runId, run.id)),
      db.select({ at: max(agentActivity.createdAt) }).from(agentActivity).where(eq(agentActivity.taskId, run.taskId)),
    ]);
    if (!isStaleRun(run, latestOf(step?.at, activity?.at), now)) continue;
    if (await stopInterruptedRun(run.id, idleBefore)) ended.push(run.id);
  }
  return ended;
}
