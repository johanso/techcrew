import type { Agent } from "@/lib/agents";

/**
 * Board vocabulary shared by the server (data) and the client (board UI, create dialog).
 * No `server-only` here: these are plain constants and types.
 */

export const BOARD_COLUMNS = [
  { id: "todo", title: "Todo", hint: "Ready to be picked up" },
  { id: "in_development", title: "In Development", hint: "Agents are building it" },
  { id: "in_review", title: "In Review", hint: "Waiting for code review" },
  { id: "testing", title: "Testing", hint: "Being verified" },
  { id: "done", title: "Done", hint: "Completed work" },
] as const;

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

export const ISSUE_TYPES = ["feature", "bug", "issue"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export type BoardCard = {
  id: string;
  /** Human-readable key, e.g. "ACM-142". */
  key: string;
  type: IssueType;
  title: string;
  description: string;
  priority: IssuePriority;
  /** Not settable yet (no agents table); kept so cards can show an agent once assignment exists. */
  assignee: Agent | null;
  labels: string[];
  /** Calendar date, "yyyy-MM-dd". */
  dueDate: string | null;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
};

/** Fields a user can set when creating or editing a card. */
export type BoardCardInput = {
  type: IssueType;
  title: string;
  description: string;
  priority: IssuePriority;
  status: BoardColumnId;
  dueDate: string | null;
  labels: string[];
};

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 5000;
export const LABELS_MAX = 5;
export const LABEL_LENGTH_MAX = 30;

/** Card ids per column, in display order. */
export type BoardColumns = Record<BoardColumnId, string[]>;

export type BoardData = {
  cards: Record<string, BoardCard>;
  columns: BoardColumns;
};

export function emptyColumns(): BoardColumns {
  return { todo: [], in_development: [], in_review: [], testing: [], done: [] };
}

export function isBoardColumnId(value: unknown): value is BoardColumnId {
  return BOARD_COLUMNS.some((column) => column.id === value);
}
