import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, min, ne, notExists, sql } from "drizzle-orm";

import { agentRunSteps, agentRuns, db, pullRequests, taskReferences, tasks, workspaces, type AgentRunRow } from "@/db";
import type { AgentKey, AgentModelId } from "@/lib/agent-config";
import { VISUAL_REFERENCE_KINDS } from "@/lib/reference-config";
import {
  ACTIVE_RUN_STATUSES,
  STAGE_META,
  isAgentStage,
  isRunStage,
  isRunStatus,
  workingAgents,
  type AgentStage,
  type BoardCardRun,
  type RunFailure,
  type RunStage,
  type RunStatus,
} from "@/lib/agent-run-config";
import type { ToolStep } from "@/lib/agent-tools";
import type { BoardColumnId } from "@/lib/board-config";
import { ciForRound, type CiResult } from "@/lib/ci-gate";
import { parseRunWaiting, type RunWaiting } from "@/lib/cli-agents-config";
import { removeRunWorkdir } from "@/lib/cli";
import { isUniqueViolation } from "@/lib/db-errors";
import { removeRunSandbox } from "@/lib/sandbox";
import { parseRunPreview, previewUrl } from "@/lib/sandbox/config";
import { stopRunPreview } from "@/lib/sandbox/preview";

/**
 * Agent runs: one pass of a card through the pipeline (lib/inngest/agent-run.ts). Callers authorize the workspace;
 * the pipeline itself only touches the run's own workspace and task.
 */


/**
 * Starts a run, or returns null when the card already has one in flight: a unique index allows one queued or running
 * run per card, so two computers (each with its own Inngest and auto pickup) can't start the same card.
 */
export async function createRun(values: {
  workspaceId: number;
  taskId: number;
  trigger: "manual" | "auto";
  createdById?: number | null;
  /** Continue on this branch (a rerun of a card whose pull request is still open). */
  branch?: string | null;
}) {
  try {
    const [row] = await db
      .insert(agentRuns)
      .values({ ...values, status: "queued" })
      .returning();
    return row!;
  } catch (error) {
    if (isUniqueViolation(error, ONE_ACTIVE_RUN)) return null;
    throw error;
  }
}

const ONE_ACTIVE_RUN = "agent_runs_one_active_per_task";

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

/**
 * A run that takes over a pull request replaces the earlier runs of these cards (the card, and the PR's own card when
 * it's a follow-up) still waiting on a merge: their pull request now belongs to the new run.
 */
export async function replaceWaitingRuns(taskIds: number[], newRunId: number) {
  const replaced = await db
    .update(agentRuns)
    .set({ status: "cancelled", error: "Replaced by a new run on the same pull request.", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(agentRuns.taskId, taskIds), eq(agentRuns.status, "awaiting_merge"), ne(agentRuns.id, newRunId)))
    .returning({ id: agentRuns.id });
  // The new run starts its own preview after its CI gate; the old one goes now, in the background.
  for (const { id } of replaced) void stopRunPreview(id, "Replaced by a new run on the same pull request.");
}

/**
 * Marks the run as working in `phase`, only while it is still queued or running: in the review phase two stages begin
 * in parallel, and one may have stopped the run meanwhile. Returns false when the run already ended.
 */
export async function markStageRunning(runId: number, phase: RunStage) {
  const rows = await db
    .update(agentRuns)
    .set({ status: "running", stage: phase, error: null, failure: null, updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES])))
    .returning({ id: agentRuns.id });
  return rows.length > 0;
}

/**
 * Ends a run. Terminal statuses get `finished_at`; awaiting_merge stays open until the merge. `failure` says why as
 * data when the UI can act on it (out of credit → switch and retry).
 */
export async function finishRun(runId: number, status: RunStatus, error: string | null = null, failure: RunFailure | null = null) {
  const terminal = status !== "awaiting_merge";
  await updateRun(runId, { status, error, failure, waiting: null, cliResults: null, ...(terminal ? { finishedAt: new Date() } : {}) });
  // No agent works on the run any more (a merge needs no sandbox): free its checkout in the background, and the
  // working folder of its CLI sessions on this computer.
  void removeRunSandbox(runId);
  void removeRunWorkdir(runId);
  // The preview outlives the run while its pull request waits (awaiting_merge) or stays open after a failure, until
  // it's merged or closed or two hours pass; a stopped or merged run leaves nothing to look at.
  if (status === "cancelled" || status === "completed") {
    void stopRunPreview(runId, status === "cancelled" ? "The run was stopped." : "The pull request was merged.");
  }
}

/** What the run waits for outside itself (the owner's plan to reset), or null when it stopped waiting. */
export async function setRunWaiting(runId: number, waiting: RunWaiting | null) {
  await updateRun(runId, { waiting });
}

/** A CLI agent's stage result, stored by the MCP endpoint until the stage's step reads it ("<stage>:<round>"). */
export async function saveCliResult(runId: number, key: string, result: unknown) {
  await db
    .update(agentRuns)
    .set({ cliResults: sql`coalesce(${agentRuns.cliResults}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(result)}::jsonb)`, updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));
}

export async function readCliResult(runId: number, key: string): Promise<unknown> {
  const [row] = await db.select({ results: agentRuns.cliResults }).from(agentRuns).where(eq(agentRuns.id, runId));
  return row?.results?.[key] ?? null;
}

/** Forgets a stage's stored result before it starts (a restarted stage must submit again). */
export async function clearCliResult(runId: number, key: string) {
  await db
    .update(agentRuns)
    .set({ cliResults: sql`coalesce(${agentRuns.cliResults}, '{}'::jsonb) - ${key}::text` })
    .where(eq(agentRuns.id, runId));
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

/** The public URL of a run's preview while it's running, else null. */
export function runningPreviewUrl(value: unknown) {
  const preview = parseRunPreview(value);
  return preview?.status === "running" ? previewUrl(preview) : null;
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
      failure: agentRuns.failure,
      ci: agentRuns.ci,
      reworkRounds: agentRuns.reworkRounds,
      preview: agentRuns.preview,
      waiting: agentRuns.waiting,
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
      failure: row.failure ?? null,
      pullRequest: row.prNumber !== null && row.prUrl ? { number: row.prNumber, url: row.prUrl } : null,
      ci: ciForRound(row.ci, row.reworkRounds)?.state ?? null,
      preview: runningPreviewUrl(row.preview),
      waiting: parseRunWaiting(row.waiting),
    });
  }
  return byTask;
}

/**
 * Stages that ended (result or stop) in the given rounds of these runs. A phase's agent whose stage ended is no longer
 * working, even while its parallel partner still is.
 */
export async function getEndedStages(runs: { id: number; reworkRounds: number }[]) {
  const ended = new Map<number, AgentStage[]>();
  if (!runs.length) return ended;
  const rows = await db
    .select({ runId: agentRunSteps.runId, stage: agentRunSteps.stage, round: agentRunSteps.round })
    .from(agentRunSteps)
    .where(and(inArray(agentRunSteps.runId, runs.map((run) => run.id)), inArray(agentRunSteps.tool, ["result", "stopped"])));
  for (const row of rows) {
    const run = runs.find((r) => r.id === row.runId);
    if (!run || row.round !== run.reworkRounds || !isAgentStage(row.stage)) continue;
    ended.set(row.runId, [...(ended.get(row.runId) ?? []), row.stage]);
  }
  return ended;
}

/** Agents working right now in the workspace (for the AI Team "Working" status); two at once in the review phase. */
export async function getWorkingAgents(workspaceId: number) {
  const runs = await db
    .select({ id: agentRuns.id, stage: agentRuns.stage, reworkRounds: agentRuns.reworkRounds })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, "running")));
  const ended = await getEndedStages(runs);
  return new Set(runs.flatMap((run) => (isRunStage(run.stage) ? workingAgents(run.stage, ended.get(run.id) ?? []) : [])));
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
    const taskId = await nextPickupTask(id);
    if (taskId !== null) picks.push({ workspaceId: id, taskId });
  }
  return picks;
}

/**
 * The top Todo card of a workspace that was never run, or null. `withoutVisual` skips cards with image or link
 * references (an agent that must see them can't), so such a card doesn't hold up the rest of the column.
 */
export async function nextPickupTask(workspaceId: number, { withoutVisual = false } = {}) {
  const neverRun = db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.taskId, tasks.id));
  const visual = db
    .select({ id: taskReferences.id })
    .from(taskReferences)
    .where(and(eq(taskReferences.taskId, tasks.id), inArray(taskReferences.kind, [...VISUAL_REFERENCE_KINDS])));
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.status, "todo"),
        isNull(tasks.removedAt),
        notExists(neverRun),
        withoutVisual ? notExists(visual) : undefined
      )
    )
    .orderBy(tasks.position, tasks.id)
    .limit(1);
  return task?.id ?? null;
}

// ── Agent log ──────────────────────────────────────────────────────────────────

type StepPosition = { stage: AgentStage; round: number; turn: number; model: AgentModelId };
// The stage's end row sorts after every tool call of its turn.
const END_SEQ = 1000;

async function upsertSteps(rows: (typeof agentRunSteps.$inferInsert)[]) {
  if (!rows.length) return;
  await db
    .insert(agentRunSteps)
    .values(rows)
    .onConflictDoUpdate({
      target: [agentRunSteps.runId, agentRunSteps.stage, agentRunSteps.round, agentRunSteps.turn, agentRunSteps.seq],
      set: {
        tool: sql`excluded.tool`,
        target: sql`excluded.target`,
        ok: sql`excluded.ok`,
        summary: sql`excluded.summary`,
        model: sql`excluded.model`,
        costMicros: sql`excluded.cost_micros`,
        // A retried browse_preview took a new screenshot: point at it (the old object stays, unreferenced).
        screenshotKey: sql`excluded.screenshot_key`,
      },
    });
}

/** One turn's tool calls, at fixed positions (seq 0, 1 …) so a retried Inngest step rewrites instead of duplicating. */
export async function saveRunSteps(runId: number, at: StepPosition, steps: ToolStep[]) {
  await upsertSteps(steps.map((step, seq) => ({ runId, ...at, seq, ...step })));
}

/**
 * One tool call a CLI agent made through the MCP endpoint, logged as it happens at the next free position of the
 * chunk's turn. Calls can arrive in parallel: a taken position is retried at the next one.
 */
export async function appendRunStep(runId: number, at: StepPosition, step: ToolStep) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [last] = await db
      .select({ seq: max(agentRunSteps.seq) })
      .from(agentRunSteps)
      .where(
        and(
          eq(agentRunSteps.runId, runId),
          eq(agentRunSteps.stage, at.stage),
          eq(agentRunSteps.round, at.round),
          eq(agentRunSteps.turn, at.turn),
          sql`${agentRunSteps.seq} < ${END_SEQ}`
        )
      );
    const inserted = await db
      .insert(agentRunSteps)
      .values({ runId, ...at, seq: (last?.seq ?? -1) + 1, ...step })
      .onConflictDoNothing()
      .returning({ id: agentRunSteps.id });
    if (inserted.length) return;
  }
  console.warn(`[agents] run ${runId}: couldn't log a ${step.tool} call`);
}

/**
 * The run's preview in the agent log: one row per development round, after that round's development stage (tool
 * `preview`, the public host as target, a one-line summary; never the preview's output).
 */
export async function savePreviewStep(runId: number, round: number, step: ToolStep) {
  const [last] = await db
    .select({ turn: max(agentRunSteps.turn) })
    .from(agentRunSteps)
    .where(and(eq(agentRunSteps.runId, runId), eq(agentRunSteps.stage, "development"), eq(agentRunSteps.round, round)));
  await upsertSteps([{ runId, stage: "development", round, turn: last?.turn ?? 1, seq: END_SEQ + 1, model: null, ...step }]);
}

/** Tool calls an agent stage made in a round (its agent log rows below the end markers). */
export async function countStageToolCalls(runId: number, stage: AgentStage, round: number) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRunSteps)
    .where(
      and(
        eq(agentRunSteps.runId, runId),
        eq(agentRunSteps.stage, stage),
        eq(agentRunSteps.round, round),
        sql`${agentRunSteps.seq} < ${END_SEQ}`,
        // Route notes are the pipeline's, not the agent's calls.
        ne(agentRunSteps.tool, "route")
      )
    );
  return row?.count ?? 0;
}

/** How a stage ended: its result (ok) or why it stopped, with the stage's model spend. */
export async function saveStageEnd(runId: number, at: StepPosition, end: { ok: boolean; summary: string; costMicros: number }) {
  await upsertSteps([{ runId, ...at, seq: END_SEQ, tool: end.ok ? "result" : "stopped", target: null, ...end }]);
}

export type RunLogStep = {
  id: number;
  tool: string;
  target: string | null;
  ok: boolean;
  summary: string | null;
  turn: number;
  /** The step has a screenshot (browse_preview), served by /api/runs/<run>/steps/<id>/screenshot. Never the key. */
  screenshot: boolean;
};

/** The storage key of a step's screenshot, only when the step belongs to that run in a workspace `ownerId` owns. */
export async function getStepScreenshotKey(ownerId: number, runId: number, stepId: number) {
  const [row] = await db
    .select({ key: agentRunSteps.screenshotKey })
    .from(agentRunSteps)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunSteps.runId))
    .innerJoin(workspaces, eq(workspaces.id, agentRuns.workspaceId))
    .where(and(eq(agentRunSteps.id, stepId), eq(agentRunSteps.runId, runId), eq(workspaces.ownerId, ownerId)));
  return row?.key ?? null;
}

export type RunLogStage = {
  stage: AgentStage;
  round: number;
  agent: AgentKey;
  model: AgentModelId | null;
  turns: number;
  costMicros: number;
  steps: RunLogStep[];
  /** How the stage ended — a result, a question for the owner (analysis, needs info) or a stop — and in what words; null while it's still working. */
  end: { kind: "result" | "question" | "stopped"; summary: string | null } | null;
  /** Files written, edited or deleted, in order, without repeats. */
  filesChanged: string[];
};

export type RunLog = {
  run: {
    id: number;
    status: RunStatus;
    stage: RunStage | null;
    error: string | null;
    costMicros: number;
    reworkRounds: number;
    startedAt: Date;
    finishedAt: Date | null;
  };
  stages: RunLogStage[];
  /** CI on each development round's push (the gate before review). */
  ci: CiResult[];
};

const WRITE_TOOLS = new Set(["write_file", "replace_in_file", "delete_file", "resolve_conflict"]);

/**
 * The card's latest run with what each stage did, grouped in the order the stages started (the parallel review and
 * security stages interleave by time, each in its own group). Null if never run.
 */
export async function getTaskRunLog(workspaceId: number, taskId: number): Promise<RunLog | null> {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.taskId, taskId)))
    .orderBy(desc(agentRuns.id))
    .limit(1);
  if (!run || !isRunStatus(run.status)) return null;

  const rows = await db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, run.id))
    .orderBy(asc(agentRunSteps.createdAt), asc(agentRunSteps.round), asc(agentRunSteps.turn), asc(agentRunSteps.seq));

  const stages: RunLogStage[] = [];
  for (const row of rows) {
    if (!isAgentStage(row.stage)) continue;
    let group = stages.find((g) => g.stage === row.stage && g.round === row.round);
    if (!group) {
      group = {
        stage: row.stage,
        round: row.round,
        agent: STAGE_META[row.stage].agent,
        model: (row.model as AgentModelId | null) ?? null,
        turns: 0,
        costMicros: 0,
        steps: [],
        end: null,
        filesChanged: [],
      };
      stages.push(group);
    }
    group.turns = Math.max(group.turns, row.turn);
    if (row.tool === "result" || row.tool === "stopped") {
      // A run ends in needs_info only from its analysis, so that stage's result is the question.
      const question = row.tool === "result" && row.stage === "analysis" && run.status === "needs_info";
      group.end = { kind: question ? "question" : row.tool === "result" ? "result" : "stopped", summary: row.summary };
      group.costMicros = row.costMicros;
      continue;
    }
    group.steps.push({
      id: row.id,
      tool: row.tool,
      target: row.target,
      ok: row.ok,
      summary: row.summary,
      turn: row.turn,
      screenshot: row.screenshotKey !== null,
    });
    if (row.ok && row.target && WRITE_TOOLS.has(row.tool) && !group.filesChanged.includes(row.target)) {
      group.filesChanged.push(row.target);
    }
  }

  return {
    run: {
      id: run.id,
      status: run.status,
      stage: isRunStage(run.stage) ? run.stage : null,
      error: run.error,
      costMicros: run.costMicros,
      reworkRounds: run.reworkRounds,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    stages,
    ci: run.ci ?? [],
  };
}
