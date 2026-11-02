"use server";

import { createTask, getBoardData, isGithubTask, parseBoardInput, parseCardInput, reorderTasks, updateTask } from "@/lib/board";
import type { BoardCard, BoardColumnId, BoardData } from "@/lib/board-config";
import { syncWorkspaceIssues, type SyncResult } from "@/lib/github-issues";
import { requireUser } from "@/lib/current-user";
import { getOwnedWorkspace } from "@/lib/workspaces";

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
  const changed = result.added + result.updated + result.closed + result.reopened > 0;
  return changed || options.includeBoard ? { ...result, board: await getBoardData(auth.workspace) } : result;
}
