import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, taskEvents, tasks } from "@/db";
import { taskKeyPrefix } from "@/lib/agents";
import { BOARD_COLUMNS, type BoardCardInput, type BoardColumnId } from "@/lib/board-config";

/**
 * People's work on the board for the Activity page: a card moved to another column, edited, or removed.
 * Logged by the board actions after the change is saved. Reordering within a column isn't logged (noise).
 */

export const TASK_EVENT_KINDS = ["task_moved", "task_edited", "task_removed"] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** A card as it was before a change: what the event compares against. */
export type TaskSnapshot = {
  id: number;
  number: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  dueDate: string | null;
  labels: string[];
};

const columnTitle = (id: string) => BOARD_COLUMNS.find((c) => c.id === id)?.title ?? id;

/** Cards of the workspace as they are now (call before changing them). */
export async function taskSnapshots(workspaceId: number, ids: number[]): Promise<Map<number, TaskSnapshot>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      type: tasks.type,
      priority: tasks.priority,
      status: tasks.status,
      dueDate: tasks.dueDate,
      labels: tasks.labels,
    })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * What an edit changed, in words ("priority", "due date", "moved to In Review"), and whether it was only a move.
 * `input` holds the fields the dialog saved (GitHub cards save board fields only).
 */
export function describeCardChanges(before: TaskSnapshot, input: Partial<BoardCardInput>) {
  const changes: string[] = [];
  const differs = <K extends keyof BoardCardInput>(key: K, current: unknown) => key in input && input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current);
  if (differs("title", before.title)) changes.push("title");
  if (differs("description", before.description)) changes.push("description");
  if (differs("type", before.type)) changes.push("type");
  if (differs("priority", before.priority)) changes.push("priority");
  if (differs("dueDate", before.dueDate)) changes.push("due date");
  if (differs("labels", before.labels)) changes.push("labels");
  const movedTo = differs("status", before.status) ? (input.status as BoardColumnId) : null;
  return { changes, movedTo, onlyMoved: movedTo !== null && changes.length === 0 };
}

/** Never throws: the change itself is already saved, and a missing timeline entry mustn't undo it for the user. */
async function log(values: { workspaceId: number; taskId: number; userId: number; kind: TaskEventKind; title: string; detail: string | null }[]) {
  if (!values.length) return;
  try {
    await db.insert(taskEvents).values(values);
  } catch (error) {
    console.error("[task-events] log failed", error);
  }
}

type Actor = { workspace: { id: number; name: string }; userId: number };
const cardKey = (actor: Actor, snapshot: TaskSnapshot) => `${taskKeyPrefix(actor.workspace.name)}-${snapshot.number}`;

export async function logCardEdited(actor: Actor, before: TaskSnapshot, input: Partial<BoardCardInput>) {
  const { changes, movedTo, onlyMoved } = describeCardChanges(before, input);
  const key = cardKey(actor, before);
  const base = { workspaceId: actor.workspace.id, taskId: before.id, userId: actor.userId };
  if (onlyMoved) {
    return log([{ ...base, kind: "task_moved", title: `Moved ${key} to ${columnTitle(movedTo!)}`, detail: before.title }]);
  }
  if (!changes.length) return;
  const parts = [...changes, ...(movedTo ? [`moved to ${columnTitle(movedTo)}`] : [])];
  return log([{ ...base, kind: "task_edited", title: `Edited ${key}`, detail: `${before.title} · ${parts.join(", ")}` }]);
}

/** After a drag and drop: one event per card that landed in another column. */
export async function logCardsMoved(actor: Actor, before: Map<number, TaskSnapshot>, columns: Partial<Record<BoardColumnId, number[]>>) {
  const values = Object.entries(columns).flatMap(([column, ids]) =>
    (ids ?? []).flatMap((id) => {
      const snapshot = before.get(id);
      // Unknown columns are ignored by reorderTasks too.
      if (!snapshot || snapshot.status === column || !BOARD_COLUMNS.some((c) => c.id === column)) return [];
      return [
        {
          workspaceId: actor.workspace.id,
          taskId: id,
          userId: actor.userId,
          kind: "task_moved" as const,
          title: `Moved ${cardKey(actor, snapshot)} to ${columnTitle(column)}`,
          detail: snapshot.title,
        },
      ];
    })
  );
  return log(values);
}

export async function logCardRemoved(actor: Actor, before: TaskSnapshot) {
  return log([
    { workspaceId: actor.workspace.id, taskId: before.id, userId: actor.userId, kind: "task_removed", title: `Removed ${cardKey(actor, before)}`, detail: before.title },
  ]);
}
