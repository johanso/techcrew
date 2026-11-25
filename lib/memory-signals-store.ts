import "server-only";

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { agentRunSteps, agentRuns, db, memorySignals, pullRequests, tasks, workspaces, type PullRequestRow, type Workspace } from "@/db";
import { taskKeyPrefix } from "@/lib/agents";
import { ciForRound, ciSummary } from "@/lib/ci-gate";
import type { MemoryScanFinding } from "@/lib/memory-scan";
import {
  buildAnswerSignal,
  buildLessonSignal,
  buildRejectionSignal,
  buildRememberSignal,
  buildReworkSignal,
  cardRememberText,
  collectsSignals,
  isSignalKind,
  shouldAskWhyRejected,
  signalsToPrune,
  stepRememberText,
  SIGNALS_PER_WORKSPACE_MAX,
  type BuiltSignal,
  type Lesson,
  type RememberPrefill,
  type ReworkCause,
  type SignalDraft,
  type SignalField,
  type SignalKind,
  type SignalPayload,
} from "@/lib/memory-signals";

/**
 * The Brain's signals on the server (docs/brain-plan.md): writing them from the pipeline, the pull request sync and the
 * owner's actions, the "Why was this rejected?" question, and the Activity list. One rule above all: nothing here
 * throws into a run, a sync or an action. A signal that can't be recorded costs one warning, never the work it came from.
 * With memory off nothing is collected or asked on its own (collectsSignals), nor when the mode can't be read.
 * Callers authorize the workspace; agents have no way to read any of this.
 */

/** The database's own words about a failure. Never the query: its parameters hold the signal's text. */
function describe(error: unknown) {
  if (error instanceof Error) return error.cause instanceof Error ? error.cause.message : error.name;
  return "unknown error";
}

async function quietly<T>(what: string, fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.warn(`[signals] couldn't ${what}: ${describe(error)}`);
    return fallback;
  }
}

// ── Writing ────────────────────────────────────────────────────────────────────

type SignalRefs = { runId?: number | null; taskId?: number | null; prNumber?: number | null };

/** Keeps at most SIGNALS_PER_WORKSPACE_MAX signals (signalsToPrune decides which go). */
async function prune(workspaceId: number) {
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(memorySignals).where(eq(memorySignals.workspaceId, workspaceId));
  if (count <= SIGNALS_PER_WORKSPACE_MAX) return;
  const rows = await db
    .select({ id: memorySignals.id, createdAt: memorySignals.createdAt, consumedAt: memorySignals.consumedAt })
    .from(memorySignals)
    .where(eq(memorySignals.workspaceId, workspaceId));
  const old = signalsToPrune(rows);
  if (old.length) await db.delete(memorySignals).where(and(eq(memorySignals.workspaceId, workspaceId), inArray(memorySignals.id, old)));
}

/**
 * Stores one signal. The same source again is left as it is, except the owner's own input (`replace`), which takes the
 * new words: they count as unused again only when they changed, and never lose their trusted mark.
 */
async function insertSignal(workspaceId: number, refs: SignalRefs, draft: SignalDraft) {
  const insert = db.insert(memorySignals).values({
    workspaceId,
    kind: draft.kind,
    sourceKey: draft.sourceKey,
    runId: refs.runId ?? null,
    taskId: refs.taskId ?? null,
    prNumber: refs.prNumber ?? null,
    payload: draft.payload,
    trusted: draft.trusted,
    // From here, not the column's default: that writes the database's local time, which reads back shifted.
    createdAt: new Date(),
  });
  const target = [memorySignals.workspaceId, memorySignals.kind, memorySignals.sourceKey];
  const changed = sql`${memorySignals.payload} is distinct from excluded.payload`;
  const stored = draft.replace
    ? await insert
        .onConflictDoUpdate({
          target,
          set: {
            payload: sql`excluded.payload`,
            trusted: sql`${memorySignals.trusted} or excluded.trusted`,
            createdAt: sql`case when ${changed} then excluded.created_at else ${memorySignals.createdAt} end`,
            consumedAt: sql`case when ${changed} then null else ${memorySignals.consumedAt} end`,
          },
        })
        .returning({ id: memorySignals.id })
    : await insert.onConflictDoNothing({ target }).returning({ id: memorySignals.id });
  // The signal is stored even if old ones couldn't be cleared; the next one tries again.
  if (stored.length) await quietly("clear old signals", undefined, () => prune(workspaceId));
  return stored.length > 0;
}

/** Stores what a builder made, if anything. Texts the scan refused are counted in one warning, never stored. */
async function keep(workspaceId: number, refs: SignalRefs, built: BuiltSignal, what: string) {
  if (!built.ok) {
    if (built.reason === "blocked") console.warn(`[signals] ${what}: dropped, the security scan refused its text`);
    return false;
  }
  if (built.dropped) console.warn(`[signals] ${what}: ${built.dropped} text(s) left out, the security scan refused them`);
  return insertSignal(workspaceId, refs, built.draft);
}

/** A run's workspace, card, pull request number and stored results, or null when there is nothing to collect from it. */
async function collectingRun(runId: number) {
  const [row] = await db
    .select({ run: agentRuns, memoryMode: workspaces.memoryMode })
    .from(agentRuns)
    .innerJoin(workspaces, eq(workspaces.id, agentRuns.workspaceId))
    .where(eq(agentRuns.id, runId));
  if (!row || !collectsSignals(row.memoryMode)) return null;
  const { run } = row;
  const [pr] = await db
    .select({ number: pullRequests.number })
    .from(pullRequests)
    .where(eq(pullRequests.runId, runId))
    .orderBy(desc(pullRequests.id))
    .limit(1);
  return { run, refs: { runId, taskId: run.taskId, prNumber: pr?.number ?? null } satisfies SignalRefs };
}

type Run = typeof agentRuns.$inferSelect;

/** What sent a round back, as the pipeline stored it. */
function reworkFeedback(run: Run, round: number, cause: ReworkCause): string[] {
  if (cause === "lead") {
    const approval = run.approval;
    return approval ? [approval.summary, ...approval.requiredChanges.map((c) => `(${c.source}) ${c.path}: ${c.detail}`)] : [];
  }
  if (cause === "tests") {
    const report = run.testReport;
    return report ? [report.summary, ...report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)] : [];
  }
  const ci = ciForRound(run.ci, round);
  return ci ? [ciSummary(ci), ...ci.failing.map((c) => `${c.name}: ${c.conclusion ?? "failed"}`)] : [];
}

/** A rework round starts: what sent the work back (untrusted), once per run, round and cause. */
export function recordReworkSignal(runId: number, round: number, cause: ReworkCause) {
  return quietly("record a rework round", false, async () => {
    const facts = await collectingRun(runId);
    if (!facts) return false;
    const built = buildReworkSignal({ runId, round, cause, feedback: reworkFeedback(facts.run, round, cause) });
    return keep(facts.run.workspaceId, facts.refs, built, `rework of run ${runId}`);
  });
}

/** The owner answered the Analyst's question on this run: the question (untrusted) and the answer. */
export function recordAnswerSignal(runId: number, answer: string) {
  return quietly("record the answer", false, async () => {
    const facts = await collectingRun(runId);
    if (!facts) return false;
    const question = facts.run.brief?.question || facts.run.error || "";
    return keep(facts.run.workspaceId, facts.refs, buildAnswerSignal({ runId, question, answer }), `answer on run ${runId}`);
  });
}

/** The lessons the Lead suggested on this run (untrusted), one per title. Returns how many were new. */
export function recordLessonSignals(runId: number, lessons: readonly Lesson[]) {
  return quietly("record the Lead's lessons", 0, async () => {
    if (!lessons.length) return 0;
    const facts = await collectingRun(runId);
    if (!facts) return 0;
    let stored = 0;
    for (const lesson of lessons) {
      if (await keep(facts.run.workspaceId, facts.refs, buildLessonSignal(lesson), `lesson of run ${runId}`)) stored++;
    }
    return stored;
  });
}

// ── Rejected pull requests ─────────────────────────────────────────────────────

/** After a pull request was found closed without merging: asks the owner why, once (shouldAskWhyRejected). */
export function askWhyRejected(pullRequestId: number) {
  return quietly("ask why a pull request was rejected", false, async () => {
    const [row] = await db
      .select({ pr: pullRequests, memoryMode: workspaces.memoryMode })
      .from(pullRequests)
      .innerJoin(workspaces, eq(workspaces.id, pullRequests.workspaceId))
      .where(eq(pullRequests.id, pullRequestId));
    if (!row || !collectsSignals(row.memoryMode)) return false;
    const { pr } = row;
    const later = await db
      .select({ id: pullRequests.id, taskId: pullRequests.taskId, headBranch: pullRequests.headBranch })
      .from(pullRequests)
      .where(and(eq(pullRequests.workspaceId, pr.workspaceId), gt(pullRequests.id, pr.id)));
    if (!shouldAskWhyRejected(pr, later)) return false;
    const rows = await db
      .update(pullRequests)
      .set({ rejectionPrompt: "pending" })
      // Conditional: a second sync, or a merge that arrived meanwhile, changes nothing.
      .where(and(eq(pullRequests.id, pr.id), eq(pullRequests.state, "closed"), isNull(pullRequests.mergedAt), isNull(pullRequests.rejectionPrompt)))
      .returning({ id: pullRequests.id });
    return rows.length > 0;
  });
}

const waitingForReason = and(eq(pullRequests.state, "closed"), isNull(pullRequests.mergedAt), eq(pullRequests.rejectionPrompt, "pending"));

/**
 * The question each board card shows (its newest rejected pull request still waiting for a reason), by task id. None
 * while memory is off: the pending ones are only hidden, and show again when it is turned on.
 */
export function getPendingRejections(workspaceId: number) {
  return quietly("list the rejected pull requests", new Map<number, { pullRequestId: number; number: number }>(), async () => {
    const rows = await db
      .select({ id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId, memoryMode: workspaces.memoryMode })
      .from(pullRequests)
      .innerJoin(workspaces, eq(workspaces.id, pullRequests.workspaceId))
      .where(and(eq(pullRequests.workspaceId, workspaceId), waitingForReason))
      .orderBy(pullRequests.id);
    return new Map(
      rows.flatMap((row) => (row.taskId === null || !collectsSignals(row.memoryMode) ? [] : [[row.taskId, { pullRequestId: row.id, number: row.number }] as const]))
    );
  });
}

export type SignalWrite =
  | { ok: true; trusted: boolean }
  | { ok: false; message?: string; errors?: Partial<Record<SignalField, string>>; findings?: MemoryScanFinding[] };

/** A builder's refusal as a form answer. */
function refusal(built: Extract<BuiltSignal, { ok: false }>): Extract<SignalWrite, { ok: false }> {
  if (built.reason === "invalid") return { ok: false, errors: built.errors };
  if (built.reason === "blocked") return { ok: false, message: "TechTeam can't save this: the security scan found something that would steer an agent.", findings: built.findings };
  return { ok: false, errors: { text: "Write something to save." } };
}

const NOT_SAVED = "We couldn't save it. Please try again.";
const NOT_WAITING = "This pull request isn't waiting for a reason any more.";

/** Stores the owner's own input: unlike the pipeline's signals, they are told when it didn't work. */
async function storeOwnerSignal(workspaceId: number, refs: SignalRefs, draft: SignalDraft): Promise<SignalWrite> {
  const stored = await quietly("save the owner's signal", false, () => insertSignal(workspaceId, refs, draft));
  return stored ? { ok: true, trusted: draft.trusted } : { ok: false, message: NOT_SAVED };
}

/** The owner says why a pull request was rejected: recorded (trusted), and the question is closed. */
export function answerRejection(workspaceId: number, pullRequestId: number, input: { reason: unknown; note: unknown }) {
  return quietly<SignalWrite>("save the rejection's reason", { ok: false, message: NOT_SAVED }, async () => {
    if (!Number.isSafeInteger(pullRequestId)) return { ok: false, message: NOT_WAITING };
    const [pr] = await db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.workspaceId, workspaceId), eq(pullRequests.id, pullRequestId), waitingForReason));
    if (!pr) return { ok: false, message: NOT_WAITING };
    const built = buildRejectionSignal({ prNumber: pr.number, ...input });
    if (!built.ok) return refusal(built);
    const saved = await storeOwnerSignal(workspaceId, rejectionRefs(pr), built.draft);
    // The question stays open until the reason is stored.
    if (saved.ok) await db.update(pullRequests).set({ rejectionPrompt: "answered" }).where(and(eq(pullRequests.id, pr.id), waitingForReason));
    return saved;
  });
}

const rejectionRefs = (pr: PullRequestRow): SignalRefs => ({ runId: pr.runId, taskId: pr.taskId, prNumber: pr.number });

/** "Don't ask": remembered on the pull request, so it never asks again. False when there was no question to close. */
export function dismissRejection(workspaceId: number, pullRequestId: number) {
  return quietly("dismiss the question", false, async () => {
    if (!Number.isSafeInteger(pullRequestId)) return false;
    const rows = await db
      .update(pullRequests)
      .set({ rejectionPrompt: "dismissed" })
      .where(and(eq(pullRequests.workspaceId, workspaceId), eq(pullRequests.id, pullRequestId), waitingForReason))
      .returning({ id: pullRequests.id });
    return rows.length > 0;
  });
}

// ── Remember this ──────────────────────────────────────────────────────────────

/** Where "Remember this" was used: a card, or one entry of a card's agent log. */
export type RememberSource = { taskId: number; stepId: number | null };

/** The card, and the text its dialog started with, only when both belong to the workspace. */
async function rememberContext(workspaceId: number, source: RememberSource) {
  if (!Number.isSafeInteger(source.taskId)) return null;
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, githubIssueId: tasks.githubIssueId, createdById: tasks.createdById })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, source.taskId), isNull(tasks.removedAt)));
  if (!task) return null;
  if (source.stepId === null) {
    // A card typed in the app is the owner's own; a GitHub issue's title or one an agent filed is not.
    const prefill: RememberPrefill = { text: cardRememberText(task.title), trusted: task.githubIssueId === null && task.createdById !== null };
    return { prefill, refs: { taskId: task.id } satisfies SignalRefs };
  }
  if (!Number.isSafeInteger(source.stepId)) return null;
  const [step] = await db
    .select({ runId: agentRunSteps.runId, tool: agentRunSteps.tool, target: agentRunSteps.target, summary: agentRunSteps.summary })
    .from(agentRunSteps)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunSteps.runId))
    .where(and(eq(agentRunSteps.id, source.stepId), eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.taskId, task.id)));
  if (!step) return null;
  const [pr] = await db.select({ number: pullRequests.number }).from(pullRequests).where(eq(pullRequests.runId, step.runId)).limit(1);
  const prefill: RememberPrefill = { text: stepRememberText(step), trusted: false };
  return { prefill, refs: { taskId: task.id, runId: step.runId, prNumber: pr?.number ?? null } satisfies SignalRefs };
}

/** "Remember this": the owner's note from a card or a log entry. */
export function rememberNote(workspaceId: number, source: RememberSource, input: { text: unknown; scope: unknown }) {
  return quietly<SignalWrite>("save the note", { ok: false, message: NOT_SAVED }, async () => {
    const context = await rememberContext(workspaceId, source);
    if (!context) return { ok: false, message: "That card or log entry isn't there any more." };
    const built = buildRememberSignal({ ...input, prefill: context.prefill });
    return built.ok ? storeOwnerSignal(workspaceId, context.refs, built.draft) : refusal(built);
  });
}

// ── Reading (the Brain page) ───────────────────────────────────────────────────

export type SignalView = {
  id: number;
  kind: SignalKind;
  payload: SignalPayload;
  trusted: boolean;
  createdAt: Date;
  consumedAt: Date | null;
  /** The card it came from; `removed` when it left the board. */
  card: { id: number; key: string; title: string; removed: boolean } | null;
  pullRequest: { number: number; url: string | null } | null;
};

/** A workspace's newest signals, for the Brain page's Activity. `hasMore`: older ones exist beyond `limit`. */
export async function listSignals(workspace: Pick<Workspace, "id" | "name">, limit: number): Promise<{ signals: SignalView[]; hasMore: boolean }> {
  const rows = await db
    .select({ signal: memorySignals, number: tasks.number, title: tasks.title, removedAt: tasks.removedAt, prUrl: pullRequests.url })
    .from(memorySignals)
    .leftJoin(tasks, and(eq(tasks.id, memorySignals.taskId), eq(tasks.workspaceId, memorySignals.workspaceId)))
    .leftJoin(pullRequests, and(eq(pullRequests.workspaceId, memorySignals.workspaceId), eq(pullRequests.number, memorySignals.prNumber)))
    .where(eq(memorySignals.workspaceId, workspace.id))
    .orderBy(desc(memorySignals.createdAt), desc(memorySignals.id))
    .limit(limit + 1);
  const prefix = taskKeyPrefix(workspace.name);
  const signals = rows.slice(0, limit).flatMap(({ signal, number, title, removedAt, prUrl }): SignalView[] => {
    // A kind a newer version wrote is left out rather than guessed at.
    if (!isSignalKind(signal.kind)) return [];
    return [
      {
        id: signal.id,
        kind: signal.kind,
        payload: signal.payload,
        trusted: signal.trusted,
        createdAt: signal.createdAt,
        consumedAt: signal.consumedAt,
        card: signal.taskId !== null && number !== null && title !== null ? { id: signal.taskId, key: `${prefix}-${number}`, title, removed: removedAt !== null } : null,
        pullRequest: signal.prNumber !== null ? { number: signal.prNumber, url: prUrl } : null,
      },
    ];
  });
  return { signals, hasMore: rows.length > limit };
}

/** The owner deletes a signal of their workspace. False when it isn't there. */
export async function deleteSignal(workspaceId: number, signalId: number) {
  if (!Number.isSafeInteger(signalId) || signalId <= 0) return false;
  const rows = await db
    .delete(memorySignals)
    .where(and(eq(memorySignals.workspaceId, workspaceId), eq(memorySignals.id, signalId)))
    .returning({ id: memorySignals.id });
  return rows.length > 0;
}
