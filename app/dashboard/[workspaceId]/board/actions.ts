"use server";

import { agentOnPlan, answerAnalyst, pipelineModelProblem, referenceModelProblem } from "@/lib/agent-pipeline";
import { PROVIDERS, fallbackProvider, normalizeFallbackOrder } from "@/lib/agent-config";
import { parseAnswer } from "@/lib/agent-run-config";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { finishRun, getActiveRun, getLatestRuns, getTaskRunLog, placeTask, releaseTask, type RunLog } from "@/lib/agent-runs";
import { checkAgentCanRun, getAgent, logAgentActivity, moveAgentsToProvider, RUN_AGENT_ID, teamProviders } from "@/lib/agents";
import {
  createTask,
  getBoardCard,
  getBoardData,
  isGithubTask,
  parseBoardInput,
  parseCardInput,
  removeTask,
  reorderTasks,
  updateTask,
} from "@/lib/board";
import type { BoardCard, BoardColumnId, BoardData } from "@/lib/board-config";
import { syncWorkspaceIssues, type SyncResult } from "@/lib/github-issues";
import { requireUser } from "@/lib/current-user";
import { inngest } from "@/lib/inngest/client";
import { AGENT_TASK_CANCEL, AGENT_TASK_RUN, type AgentTaskRunData } from "@/lib/inngest/agent-run";
import { logCardEdited, logCardRemoved, logCardsMoved, taskSnapshots } from "@/lib/task-events";
import { createCardRun, getTaskOpenPullRequest, mergeManually, refreshOpenPullRequests } from "@/lib/pull-requests";
import { REFERENCE_UPLOAD_MAX_BYTES, formatReferenceBytes, type ReferenceView } from "@/lib/reference-config";
import { addLinkReference, addTaskReference, listTaskReferences, removeTaskReference } from "@/lib/references";
import { linkCaptureAvailable } from "@/lib/sandbox/capture";
import { parseCaptureUrl } from "@/lib/sandbox/capture-config";
import { getOwnedWorkspace } from "@/lib/workspaces";

/** A failed action may point somewhere to fix it (e.g. AI Team → Configure when a model can't see the card's images). */
export type CardActionResult = { ok: true; card: BoardCard } | { ok: false; error: string; link?: { href: string; label: string } };

// No revalidatePath: dashboard pages are dynamic (session cookie), so they re-render on every visit, and the
// board already holds the new state on the client.

/** Every board action starts here: signed-in user + a workspace they own. */
async function authorize(workspaceId: number) {
  const user = await requireUser(`/dashboard/${workspaceId}/board`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  return workspace ? { user, workspace } : null;
}

export async function createCardAction(workspaceId: number, raw: unknown): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const input = parseCardInput(raw);
  if (!input.ok) return input;
  try {
    const card = await createTask(auth.workspace, input.value, auth.user.id);
    return { ok: true, card };
  } catch (error) {
    console.error("[board] create failed", error);
    return { ok: false, error: "We couldn't create the card. Please try again." };
  }
}

export async function updateCardAction(workspaceId: number, cardId: string, raw: unknown): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  const synced = await isGithubTask(auth.workspace, taskId);
  if (synced === null) return { ok: false, error: "This card no longer exists." };
  // GitHub-synced cards: title, description and labels belong to GitHub, so only board fields are validated/saved.
  const input = synced ? parseBoardInput(raw) : parseCardInput(raw);
  if (!input.ok) return input;
  try {
    const before = (await taskSnapshots(auth.workspace.id, [taskId])).get(taskId);
    const card = await updateTask(auth.workspace, taskId, input.value);
    if (!card) return { ok: false, error: "This card no longer exists." };
    if (before) await logCardEdited({ workspace: auth.workspace, userId: auth.user.id }, before, input.value);
    return { ok: true, card };
  } catch (error) {
    console.error("[board] update failed", error);
    return { ok: false, error: "We couldn't save your changes. Please try again." };
  }
}

/** Takes a card off the board (see removeTask: GitHub issues are left untouched). A card already gone counts as removed. */
export async function removeCardAction(workspaceId: number, cardId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId)) return { ok: true };
  try {
    const before = (await taskSnapshots(auth.workspace.id, [taskId])).get(taskId);
    if ((await removeTask(auth.workspace, taskId)) && before) await logCardRemoved({ workspace: auth.workspace, userId: auth.user.id }, before);
    return { ok: true };
  } catch (error) {
    console.error("[board] remove failed", error);
    return { ok: false, error: "We couldn't remove the card. Please try again." };
  }
}

/**
 * Run: starts the agent pipeline on a card (Analyst → Developer → Reviewer → Tester → merge). The run row is
 * created first and the job queued with its id; if queuing fails the run is marked failed, so nothing waits forever.
 */
export async function runCardAction(workspaceId: number, cardId: string): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId) || (await isGithubTask(auth.workspace, taskId)) === null) {
    return { ok: false, error: "This card no longer exists." };
  }
  return startRun(auth, taskId);
}

/**
 * Answer: replies to the analyst's question on the card's latest run (lib/agent-pipeline answerAnalyst), then runs
 * the card again. The new run's prompts carry the question and the answer.
 */
export async function answerCardAction(workspaceId: number, cardId: string, raw: unknown): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId) || (await isGithubTask(auth.workspace, taskId)) === null) {
    return { ok: false, error: "This card no longer exists." };
  }
  const answer = parseAnswer(raw);
  if (!answer.ok) return answer;
  try {
    const saved = await answerAnalyst(auth.workspace.id, taskId, answer.value);
    if (!saved.ok) return saved;
  } catch (error) {
    console.error("[board] answer failed", error);
    return { ok: false, error: "We couldn't save your answer. Please try again." };
  }
  // The answer is kept even if the run can't start (paused analyst, missing key …): the next Run picks it up.
  return startRun(auth, taskId);
}

/** Starts the pipeline on a card that exists in the workspace (callers check). */
async function startRun(auth: NonNullable<Awaited<ReturnType<typeof authorize>>>, taskId: number): Promise<CardActionResult> {
  if (await getActiveRun(auth.workspace.id, taskId)) return { ok: false, error: "The agents are already working on this card." };
  const agent = getAgent(RUN_AGENT_ID)!;
  // Paused or out-of-budget agents don't take new work (configured on the AI Team page). On the owner's plan the
  // budget doesn't apply: it spends nothing.
  const allowed = await checkAgentCanRun(auth.workspace.id, RUN_AGENT_ID, { onPlan: await agentOnPlan(auth.workspace, RUN_AGENT_ID) });
  if (!allowed.ok) return allowed;
  const modelProblem = await pipelineModelProblem(auth.workspace.id);
  if (modelProblem) return { ok: false, error: modelProblem };
  // Images on the card need an Analyst and a Developer that can see them. Models change only on the AI Team page.
  const current = await getBoardCard(auth.workspace, taskId);
  const visionProblem = current && (await referenceModelProblem(auth.workspace.id, taskId, current.key));
  if (visionProblem) return { ok: false, error: visionProblem, link: { href: `/dashboard/${auth.workspace.id}/ai-team`, label: "Open AI Team" } };

  // A card run before whose pull request is still open, or the Tester's follow-up card of one that couldn't merge:
  // continue on that branch and PR instead of opening another.
  const created = await createCardRun(auth.workspace, { taskId, trigger: "manual", createdById: auth.user.id });
  if (!created.ok) return created;
  const run = { id: created.runId };
  try {
    const data: AgentTaskRunData = { workspaceId: auth.workspace.id, taskId, runId: run.id };
    await inngest.send({ name: AGENT_TASK_RUN, data });
  } catch (error) {
    console.error("[board] run failed to queue", error);
    await finishRun(run.id, "failed", "The run couldn't be queued.");
    // Locally the usual cause is the Inngest Dev Server not running; say so instead of a generic retry.
    const hint = process.env.NODE_ENV === "production" ? "Please try again." : "Is the Inngest Dev Server running? Start the app with `npm run dev` (it starts Inngest too).";
    return { ok: false, error: `We couldn't start ${agent.name} on this card. ${hint}` };
  }
  try {
    await placeTask(auth.workspace.id, taskId, "analysis", RUN_AGENT_ID);
    const card = await getBoardCard(auth.workspace, taskId);
    if (!card) return { ok: false, error: "This card no longer exists." };
    await logAgentActivity({
      workspaceId: auth.workspace.id,
      agentId: allowed.row.id,
      kind: "task_assigned",
      title: `Assigned ${card.key}`,
      detail: card.title,
      taskId,
    }).catch((error) => console.error("[board] run activity not logged", error));
    return { ok: true, card };
  } catch (error) {
    console.error("[board] run failed to assign", error);
    return { ok: false, error: "We couldn't save the assignment. Please try again." };
  }
}

/** Stop: cancels the card's run between steps. The card stays where it is, unassigned; branch and PR are kept. */
export async function stopCardAction(workspaceId: number, cardId: string): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId)) return { ok: false, error: "This card no longer exists." };
  const run = await getActiveRun(auth.workspace.id, taskId);
  if (run) {
    await finishRun(run.id, "cancelled", "Stopped by the user.");
    await inngest.send({ name: AGENT_TASK_CANCEL, data: { runId: run.id } }).catch((error) => console.error("[board] cancel not sent", error));
    await releaseTask(auth.workspace.id, taskId);
  }
  const card = await getBoardCard(auth.workspace, taskId);
  return card ? { ok: true, card } : { ok: false, error: "This card no longer exists." };
}

/**
 * Merge from the card, for a run waiting on a manual merge. Same checks as the Pull Requests page (mergeManually).
 * The client reloads the board afterwards: the card moves to Done, or a blocked merge adds the Tester's follow-up card.
 */
export async function mergeCardAction(workspaceId: number, cardId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const pr = await getTaskOpenPullRequest(auth.workspace.id, Number(cardId));
  if (!pr) return { ok: false, error: "This card has no open pull request." };
  return mergeManually(pr);
}

/** Saves the order of the columns touched by a drag and drop. */
export async function moveCardsAction(
  workspaceId: number,
  columns: Partial<Record<BoardColumnId, string[]>>
): Promise<{ ok: boolean }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false };
  const ids = Object.fromEntries(
    Object.entries(columns).map(([column, list]) => [column, (list ?? []).map(Number).filter(Number.isSafeInteger)])
  );
  try {
    const before = await taskSnapshots(auth.workspace.id, Object.values(ids).flat());
    const ok = await reorderTasks(auth.workspace, ids);
    if (ok) await logCardsMoved({ workspace: auth.workspace, userId: auth.user.id }, before, ids);
    return { ok };
  } catch (error) {
    console.error("[board] move failed", error);
    return { ok: false };
  }
}

export type SyncIssuesResult = SyncResult & { board?: BoardData };

/**
 * Pulls new and changed GitHub issues onto the board. Returns the fresh board only when something
 * changed (so idle polls don't re-render the client), or when the client asks for it because it had
 * to skip an earlier one mid-drag.
 */
export async function syncIssuesAction(workspaceId: number, options: { includeBoard?: boolean } = {}): Promise<SyncIssuesResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, reason: "error" };
  const result = await syncWorkspaceIssues(auth.workspace);
  if (!result.ok) return result;
  // Agent PRs merged or closed on GitHub directly: cards show it without a visit to the Pull Requests page.
  const pullRequestsChanged = await refreshOpenPullRequests(auth.workspace).catch((error) => {
    console.warn("[board] pull request refresh failed", error);
    return 0;
  });
  const changed = result.added + result.updated + result.closed + result.reopened + pullRequestsChanged > 0;
  return changed || options.includeBoard ? { ...result, board: await getBoardData(auth.workspace) } : result;
}

/** The board as stored, without touching GitHub: polled every few seconds while agents work on a card. */
export async function getBoardAction(workspaceId: number): Promise<BoardData | null> {
  const auth = await authorize(workspaceId);
  return auth ? getBoardData(auth.workspace) : null;
}

/**
 * A card whose run stopped because its provider ran out of credit: moves the agents still on the broke company to the
 * next company with a key in the workspace's fallback order (fallbackProvider) and runs the card again. A rerun continues on its open PR.
 */
export async function switchProviderAndRetryAction(workspaceId: number, cardId: string): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId)) return { ok: false, error: "This card no longer exists." };
  const failure = (await getLatestRuns(auth.workspace.id)).get(taskId)?.failure;
  if (failure?.kind !== "out_of_credit") return { ok: false, error: "This card didn't stop for lack of credit." };

  if ((await teamProviders(auth.workspace.id))[failure.provider]) {
    const other = fallbackProvider(failure.provider, keyStatus(await getAIKeys(auth.workspace.id)), normalizeFallbackOrder(auth.workspace.aiFallbackOrder));
    if (!other) return { ok: false, error: "Add another company's API key in Settings first." };
    await moveAgentsToProvider(auth.workspace.id, failure.provider, other, `${PROVIDERS[failure.provider].label} was out of credit (Switch and retry on the board).`);
  }
  return runCardAction(workspaceId, cardId);
}

/** The card's latest run, stage by stage, for its agent log (polled while the run is active). Read-only. */
export async function getRunLogAction(workspaceId: number, cardId: string): Promise<RunLog | null> {
  const auth = await authorize(workspaceId);
  const taskId = Number(cardId);
  if (!auth || !Number.isSafeInteger(taskId)) return null;
  return getTaskRunLog(auth.workspace.id, taskId);
}

// ── References ─────────────────────────────────────────────────────────────────

export type ReferencesResult = { ok: true; references: ReferenceView[] } | { ok: false; error: string };

/** A card of this workspace that is still on the board, as an id; null otherwise. */
async function boardTaskId(auth: NonNullable<Awaited<ReturnType<typeof authorize>>>, cardId: string) {
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId) || (await isGithubTask(auth.workspace, taskId)) === null) return null;
  return taskId;
}

/** The card's references for its dialog. */
export async function listCardReferencesAction(workspaceId: number, cardId: string): Promise<ReferencesResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = await boardTaskId(auth, cardId);
  if (taskId === null) return { ok: false, error: "This card no longer exists." };
  try {
    return { ok: true, references: await listTaskReferences({ workspaceId: auth.workspace.id, taskId }) };
  } catch (error) {
    console.error("[board] references not listed", error);
    return { ok: false, error: "We couldn't load the references. Please try again." };
  }
}

/**
 * Adds one reference to a card (the dialog sends several files one call at a time, so each fits the Server Action
 * body limit). The type is checked from the bytes; lib/references.ts stores the file in local storage.
 */
export async function uploadCardReferenceAction(
  workspaceId: number,
  cardId: string,
  formData: FormData
): Promise<{ ok: true; reference: ReferenceView } | { ok: false; error: string }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = await boardTaskId(auth, cardId);
  if (taskId === null) return { ok: false, error: "This card no longer exists." };
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file." };
  if (file.size > REFERENCE_UPLOAD_MAX_BYTES) return { ok: false, error: `${file.name} is larger than ${formatReferenceBytes(REFERENCE_UPLOAD_MAX_BYTES)}.` };
  try {
    const result = await addTaskReference({
      workspaceId: auth.workspace.id,
      taskId,
      userId: auth.user.id,
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return result.ok ? result : { ok: false, error: `${file.name}: ${result.error}` };
  } catch (error) {
    console.error("[board] reference upload failed", error);
    return { ok: false, error: `We couldn't add ${file.name}. Please try again.` };
  }
}

/**
 * Adds a link to a card: the sandbox browser captures the page once, now (desktop and mobile screenshots and an
 * outline; lib/sandbox/capture.ts), and the capture is the reference. Takes 10–30 s. A failed capture stores nothing.
 */
export async function addCardLinkAction(
  workspaceId: number,
  cardId: string,
  rawUrl: unknown
): Promise<{ ok: true; reference: ReferenceView } | { ok: false; error: string }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  if (!linkCaptureAvailable()) return { ok: false, error: "Links need a sandbox host to be captured, and this server has none." };
  const taskId = await boardTaskId(auth, cardId);
  if (taskId === null) return { ok: false, error: "This card no longer exists." };
  const url = parseCaptureUrl(rawUrl);
  if (!url.ok) return url;
  try {
    return await addLinkReference({ workspaceId: auth.workspace.id, taskId, userId: auth.user.id, url: url.url });
  } catch (error) {
    console.error("[board] link capture failed", error);
    return { ok: false, error: "We couldn't capture that link. Please try again." };
  }
}

/** Deletes one reference from a card (its file too). A reference already gone counts as removed. */
export async function removeCardReferenceAction(workspaceId: number, cardId: string, referenceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  const id = Number(referenceId);
  if (!Number.isSafeInteger(taskId) || !Number.isSafeInteger(id)) return { ok: true };
  try {
    await removeTaskReference({ workspaceId: auth.workspace.id, taskId }, id);
    return { ok: true };
  } catch (error) {
    console.error("[board] reference remove failed", error);
    return { ok: false, error: "We couldn't remove the reference. Please try again." };
  }
}
