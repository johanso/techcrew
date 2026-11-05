"use server";

import { answerAnalyst, pipelineModelProblem } from "@/lib/agent-pipeline";
import { PROVIDERS, workspaceProvider } from "@/lib/agent-config";
import { parseAnswer } from "@/lib/agent-run-config";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import {
  createRun,
  finishRun,
  getActiveRun,
  getLatestRuns,
  getTaskRunLog,
  placeTask,
  releaseTask,
  replaceWaitingRuns,
  type RunLog,
} from "@/lib/agent-runs";
import { checkAgentCanRun, getAgent, logAgentActivity, RUN_AGENT_ID, switchAgentsToProvider } from "@/lib/agents";
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
import { adoptPullRequest, getRerunPullRequest, getTaskOpenPullRequest, mergeManually, refreshOpenPullRequests } from "@/lib/pull-requests";
import { getOwnedWorkspace, updateAIProvider } from "@/lib/workspaces";

export type CardActionResult = { ok: true; card: BoardCard } | { ok: false; error: string };

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
    const card = await updateTask(auth.workspace, taskId, input.value);
    if (!card) return { ok: false, error: "This card no longer exists." };
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
    await removeTask(auth.workspace, taskId);
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
  // Paused or out-of-budget agents don't take new work (configured on the AI Team page).
  const allowed = await checkAgentCanRun(auth.workspace.id, RUN_AGENT_ID);
  if (!allowed.ok) return allowed;
  const modelProblem = await pipelineModelProblem(auth.workspace.id);
  if (modelProblem) return { ok: false, error: modelProblem };

  // A card run before whose pull request is still open: continue on that branch and PR instead of opening another.
  const openPr = await getRerunPullRequest(auth.workspace, taskId);
  const run = await createRun({
    workspaceId: auth.workspace.id,
    taskId,
    trigger: "manual",
    createdById: auth.user.id,
    branch: openPr?.headBranch ?? null,
  });
  if (openPr) {
    await adoptPullRequest(openPr.id, run.id);
    await replaceWaitingRuns(taskId, run.id);
  }
  try {
    const data: AgentTaskRunData = { workspaceId: auth.workspace.id, taskId, runId: run.id };
    await inngest.send({ name: AGENT_TASK_RUN, data });
  } catch (error) {
    console.error("[board] run failed to queue", error);
    await finishRun(run.id, "failed", "The run couldn't be queued.");
    // Locally the usual cause is the Inngest Dev Server not running; say so instead of a generic retry.
    const hint = process.env.NODE_ENV === "production" ? "Please try again." : "Is the Inngest Dev Server running? Start it with `npm run inngest:dev`.";
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
    const ok = await reorderTasks(auth.workspace, ids);
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
 * A card whose run stopped because its provider ran out of credit: moves the team to the other company (if it's
 * still on the broke one; needs that company's key) and runs the card again. A rerun continues on its open PR.
 */
export async function switchProviderAndRetryAction(workspaceId: number, cardId: string): Promise<CardActionResult> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false, error: "Workspace not found." };
  const taskId = Number(cardId);
  if (!Number.isSafeInteger(taskId)) return { ok: false, error: "This card no longer exists." };
  const failure = (await getLatestRuns(auth.workspace.id)).get(taskId)?.failure;
  if (failure?.kind !== "out_of_credit") return { ok: false, error: "This card didn't stop for lack of credit." };

  if (workspaceProvider(auth.workspace) === failure.provider) {
    const other = failure.provider === "openai" ? "anthropic" : "openai";
    if (!keyStatus(await getAIKeys(auth.workspace.id))[other]) {
      return { ok: false, error: `Add an ${PROVIDERS[other].label} API key in Settings → AI providers first.` };
    }
    await updateAIProvider(auth.workspace.id, other);
    await switchAgentsToProvider(auth.workspace.id, other);
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
