import "server-only";

import { and, asc, eq, inArray, max, min } from "drizzle-orm";

import { db, tasks, workspaces, type Task, type Workspace } from "@/db";
import { taskKeyPrefix } from "@/lib/agents";
import {
  DESCRIPTION_MAX,
  emptyColumns,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  isBoardColumnId,
  LABEL_LENGTH_MAX,
  LABELS_MAX,
  TITLE_MAX,
  type BoardCard,
  type BoardCardInput,
  type BoardColumnId,
  type BoardData,
} from "@/lib/board-config";

/**
 * Kanban board persistence. Every function takes a workspace the caller has already
 * authorized (see app/dashboard/[workspaceId]/board/actions.ts) and scopes all queries to it.
 */

type BoardWorkspace = Pick<Workspace, "id" | "name">;

function toBoardCard(task: Task, workspace: BoardWorkspace): BoardCard {
  return {
    id: String(task.id),
    key: `${taskKeyPrefix(workspace.name)}-${task.number}`,
    type: task.type as BoardCard["type"],
    title: task.title,
    description: task.description,
    priority: task.priority as BoardCard["priority"],
    assignee: null,
    labels: task.labels,
    dueDate: task.dueDate,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    github:
      task.githubIssueNumber !== null && task.githubIssueUrl
        ? { number: task.githubIssueNumber, url: task.githubIssueUrl, state: task.githubIssueState === "closed" ? "closed" : "open" }
        : null,
  };
}


export async function getBoardData(workspace: BoardWorkspace): Promise<BoardData> {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.workspaceId, workspace.id))
    .orderBy(asc(tasks.position), asc(tasks.id));

  const cards: BoardData["cards"] = {};
  const columns = emptyColumns();
  for (const row of rows) {
    const card = toBoardCard(row, workspace);
    cards[card.id] = card;
    // Rows with an unknown status (e.g. a renamed column) fall back to Todo instead of disappearing.
    columns[isBoardColumnId(row.status) ? row.status : "todo"].push(card.id);
  }
  return { cards, columns };
}

// ── Validation ────────────────────────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export type ValidationResult = Parsed<BoardCardInput>;
type ContentFields = Pick<BoardCardInput, "title" | "description" | "labels">;
type BoardFields = Pick<BoardCardInput, "type" | "priority" | "status" | "dueDate">;

/** Title, description and labels. For GitHub-synced cards these come from GitHub instead. */
function parseContent(input: Record<string, unknown>): Parsed<ContentFields> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "Give the card a title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > DESCRIPTION_MAX) return { ok: false, error: "The description is too long." };

  return { ok: true, value: { title, description, labels: cleanLabels(Array.isArray(input.labels) ? input.labels : []) } };
}

/** Fields the board always owns, synced card or not. */
function parseBoardFields(input: Record<string, unknown>): Parsed<BoardFields> {
  if (!ISSUE_TYPES.includes(input.type as never)) return { ok: false, error: "Choose a type." };
  if (!ISSUE_PRIORITIES.includes(input.priority as never)) return { ok: false, error: "Choose a priority." };
  if (!isBoardColumnId(input.status)) return { ok: false, error: "Choose a status." };

  // Missing (undefined), null and "" all mean "no due date".
  const dueDate = input.dueDate == null || input.dueDate === "" ? null : input.dueDate;
  if (dueDate !== null && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate)))) {
    return { ok: false, error: "Enter a valid due date." };
  }
  return {
    ok: true,
    value: {
      type: input.type as BoardCardInput["type"],
      priority: input.priority as BoardCardInput["priority"],
      status: input.status,
      dueDate,
    },
  };
}

/** Lowercase, trimmed, unique, at most LABELS_MAX of LABEL_LENGTH_MAX characters. */
export function cleanLabels(labels: unknown[]) {
  return [
    ...new Set(
      labels
        .filter((l): l is string => typeof l === "string")
        .map((l) => l.trim().toLowerCase().slice(0, LABEL_LENGTH_MAX))
        .filter(Boolean)
    ),
  ].slice(0, LABELS_MAX);
}

/** Validates untrusted input from the client. Never trust the dialog's own checks. */
export function parseCardInput(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid card." };
  const input = raw as Record<string, unknown>;
  const content = parseContent(input);
  if (!content.ok) return content;
  const board = parseBoardFields(input);
  if (!board.ok) return board;
  return { ok: true, value: { ...content.value, ...board.value } };
}

/** Board-owned fields only — used when editing a GitHub-synced card. */
export function parseBoardInput(raw: unknown): Parsed<BoardFields> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid card." };
  return parseBoardFields(raw as Record<string, unknown>);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Creates a card at the top of its column. Numbers are allocated under a row lock on the workspace. */
export async function createTask(workspace: BoardWorkspace, input: BoardCardInput, createdById: number) {
  const row = await db.transaction(async (tx) => {
    // Serializes concurrent creates in this workspace so two cards never get the same number.
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspace.id)).for("update");
    const [{ lastNumber }] = await tx.select({ lastNumber: max(tasks.number) }).from(tasks).where(eq(tasks.workspaceId, workspace.id));
    const [{ top }] = await tx
      .select({ top: min(tasks.position) })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspace.id), eq(tasks.status, input.status)));
    const [created] = await tx
      .insert(tasks)
      .values({
        ...input,
        workspaceId: workspace.id,
        number: (lastNumber ?? 0) + 1,
        position: (top ?? 1) - 1,
        createdById,
      })
      .returning();
    return created!;
  });
  return toBoardCard(row, workspace);
}

/** Whether a card mirrors a GitHub issue (its content is then read-only in the app). */
export async function isGithubTask(workspace: BoardWorkspace, taskId: number) {
  const [row] = await db
    .select({ githubIssueId: tasks.githubIssueId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id)));
  return row ? row.githubIssueId !== null : null;
}

/**
 * Updates a card. Moving it to another column through the form appends it to the end of that column.
 * For GitHub-synced cards only board-owned fields are written; title, description and labels stay GitHub's.
 */
export async function updateTask(workspace: BoardWorkspace, taskId: number, input: BoardFields | BoardCardInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id)))
      .for("update");
    if (!current) return null;

    let position = current.position;
    if (current.status !== input.status) {
      const [{ bottom }] = await tx
        .select({ bottom: max(tasks.position) })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspace.id), eq(tasks.status, input.status)));
      position = (bottom ?? -1) + 1;
    }

    const { type, priority, status, dueDate } = input;
    const content =
      current.githubIssueId === null && "title" in input
        ? { title: input.title, description: input.description, labels: input.labels }
        : {};
    const [updated] = await tx
      .update(tasks)
      .set({ type, priority, status, dueDate, ...content, position, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning();
    return toBoardCard(updated!, workspace);
  });
}

/**
 * Persists a drag and drop: for each column given, its full, ordered list of card ids.
 * Ids that don't belong to this workspace are rejected as a whole.
 */
export async function reorderTasks(workspace: BoardWorkspace, columns: Partial<Record<BoardColumnId, number[]>>) {
  const entries = Object.entries(columns).filter((entry): entry is [BoardColumnId, number[]] => isBoardColumnId(entry[0]));
  const ids = entries.flatMap(([, list]) => list);
  if (ids.length === 0) return true;
  if (new Set(ids).size !== ids.length) return false;

  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspace.id), inArray(tasks.id, ids)));
    if (owned.length !== ids.length) return false;

    const now = new Date();
    for (const [status, list] of entries) {
      for (const [position, id] of list.entries()) {
        await tx.update(tasks).set({ status, position, updatedAt: now }).where(eq(tasks.id, id));
      }
    }
    return true;
  });
}
