import "server-only";

import { and, desc, eq, inArray, isNull, max, min, ne, notExists, sql } from "drizzle-orm";

import { agentRuns, db, pullRequests, tasks, workspaces, type AgentRunRow } from "@/db";
import type { AgentKey } from "@/lib/agent-config";
import {
  ACTIVE_RUN_STATUSES,
  RUN_STAGES,
  RUN_STATUSES,
  type BoardCardRun,
  type RunStage,
  type RunStatus,
} from "@/lib/agent-run-config";
import type { BoardColumnId } from "@/lib/board-config";

/**
 * Agent runs: one pass of a card through the pipeline (lib/inngest/agent-run.ts). Callers authorize the workspace;
 * the pipeline itself only touches the run's own workspace and task.
 */

const isRunStatus = (value: string): value is RunStatus => (RUN_STATUSES as readonly string[]).includes(value);
const isRunStage = (value: string | null): value is RunStage => value !== null && (RUN_STAGES as readonly string[]).includes(value);

export async function createRun(values: {
  workspaceId: number;
  taskId: number;
  trigger: "manual" | "auto";
  createdById?: number | null;
  /** Continue on this branch (a rerun of a card whose pull request is still open). */
  branch?: string | null;
}) {
  const [row] = await db
    .insert(agentRuns)
    .values({ ...values, status: "queued" })
    .returning();
  return row!;
}

export async function getRun(runId: number) {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  return row ?? null;
}

export async function updateRun(runId: number, patch: Partial<Omit<AgentRunRow, "id" | "workspaceId" | "taskId">>) {
  await db
    .update(agentRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));
}

/** A rerun replaces the card's earlier runs still waiting on a merge: their pull request now belongs to the new run. */
export async function replaceWaitingRuns(taskId: number, newRunId: number) {
  await db
    .update(agentRuns)
    .set({ status: "cancelled", error: "Replaced by a new run on the same pull request.", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentRuns.taskId, taskId), eq(agentRuns.status, "awaiting_merge"), ne(agentRuns.id, newRunId)));
}

/** Ends a run. Terminal statuses get `finished_at`; awaiting_merge stays open until the merge. */
export async function finishRun(runId: number, status: RunStatus, error: string | null = null) {
  const terminal = status !== "awaiting_merge";
  await updateRun(runId, { status, error, ...(terminal ? { finishedAt: new Date() } : {}) });
}

export async function addRunCost(runId: number, costMicros: number) {
  if (costMicros <= 0) return;
  await db
    .update(agentRuns)
    .set({ costMicros: sql`${agentRuns.costMicros} + ${costMicros}`, updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));
}

/** The task's queued or running run, if any. */
export async function getActiveRun(workspaceId: number, taskId: number) {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.taskId, taskId), inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES])))
    .limit(1);
  return row ?? null;
}

/** Latest run of every task in the workspace, with its pull request, keyed by task id. */
export async function getLatestRuns(workspaceId: number) {
  const rows = await db
    .selectDistinctOn([agentRuns.taskId], {
      id: agentRuns.id,
      taskId: agentRuns.taskId,
      status: agentRuns.status,
      stage: agentRuns.stage,
      error: agentRuns.error,
      prNumber: pullRequests.number,
      prUrl: pullRequests.url,
    })
    .from(agentRuns)
    .leftJoin(pullRequests, eq(pullRequests.runId, agentRuns.id))
    .where(eq(agentRuns.workspaceId, workspaceId))
    .orderBy(agentRuns.taskId, desc(agentRuns.id));

  const byTask = new Map<number, BoardCardRun>();
  for (const row of rows) {
    if (!isRunStatus(row.status)) continue;
    byTask.set(row.taskId, {
      id: row.id,
      status: row.status,
      stage: isRunStage(row.stage) ? row.stage : null,
      error: row.error,
      pullRequest: row.prNumber !== null && row.prUrl ? { number: row.prNumber, url: row.prUrl } : null,
    });
  }
  return byTask;
}

/** Stage of each agent that is working right now (for the AI Team "Working" status). */
export async function getWorkingStages(workspaceId: number) {
  const rows = await db
    .select({ stage: agentRuns.stage })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, "running")));
  return rows.map((row) => row.stage).filter(isRunStage);
}

/**
 * Moves a card to the top of a column on the agents' behalf and sets who works on it.
 * Returns false when the card was removed from the board meanwhile.
 */
export async function placeTask(workspaceId: number, taskId: number, column: BoardColumnId, assignee: AgentKey | null) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.removedAt)))
      .for("update");
    if (!current) return false;
    let position: number | undefined;
    if (current.status !== column) {
      const edge = column === "done" ? max(tasks.position) : min(tasks.position);
      const [{ value }] = await tx
        .select({ value: edge })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, column)));
      // Done collects at the bottom (like a closed issue); every other column puts the card on top.
      position = column === "done" ? (value ?? -1) + 1 : (value ?? 1) - 1;
    }
    await tx
      .update(tasks)
      .set({ status: column, ...(position !== undefined ? { position } : {}), assigneeAgentId: assignee, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    return true;
  });
}

/** After Stop: unassigns the card; one still in Analysis goes back to Todo (no work started). */
export async function releaseTask(workspaceId: number, taskId: number) {
  const [task] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) return;
  await placeTask(workspaceId, taskId, task.status === "analysis" ? "todo" : (task.status as BoardColumnId), null);
}

/**
 * Auto pickup: for each workspace with it on and no run in flight, the top Todo card that was never run.
 * Cards run before (failed, needs info, done) are left for a human to Run again.
 */
export async function findAutoPickupCandidates() {
  const busy = db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaces.id), inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES])));
  const enabled = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.agentAutoPickup, true), notExists(busy)));

  const picks: { workspaceId: number; taskId: number }[] = [];
  for (const { id } of enabled) {
    const neverRun = db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.taskId, tasks.id));
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, id), eq(tasks.status, "todo"), isNull(tasks.removedAt), notExists(neverRun)))
      .orderBy(tasks.position, tasks.id)
      .limit(1);
    if (task) picks.push({ workspaceId: id, taskId: task.id });
  }
  return picks;
}
