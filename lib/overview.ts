import "server-only";

import { addDays, differenceInCalendarDays, parseISO } from "date-fns";

import type { Workspace } from "@/db";
import { getActivityFeed, WORK_ACTIVITY_KINDS, type ActivityItem } from "@/lib/activity";
import type { BoardCardRun } from "@/lib/agent-run-config";
import { getTeamOverview, type TeamOverview } from "@/lib/agents";
import { getBoardData } from "@/lib/board";
import { ISSUE_PRIORITIES, type BoardCard, type BoardColumnId, type IssuePriority, type IssueType } from "@/lib/board-config";

/** Data for the workspace Overview page, from the board (tasks + latest runs), the agents and the activity feed. */

export type TaskStatus = "open" | "in_progress" | "pr_ready";
export type TaskPriority = IssuePriority;

export type UpcomingTask = {
  id: string;
  key: string;
  title: string;
  type: IssueType;
  status: TaskStatus;
  /** Board column the card sits in. */
  column: BoardColumnId;
  priority: TaskPriority;
  /** Calendar date, "yyyy-MM-dd". */
  dueDate: string | null;
  labels: string[];
  /** Latest agent run, or null if the card was never run. */
  run: BoardCardRun | null;
  githubIssueNumber: number | null;
};

export type OverviewStat = { count: number; hint: string };

export type OverviewData = {
  stats: { open: OverviewStat; inProgress: OverviewStat; prReady: OverviewStat };
  upcomingTasks: UpcomingTask[];
  team: TeamOverview;
  recentActivity: ActivityItem[];
};

const UPCOMING_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 6;
const IN_PROGRESS_COLUMNS: BoardColumnId[] = ["analysis", "in_development", "in_review", "testing"];

function taskStatus(card: BoardCard, column: BoardColumnId): TaskStatus {
  if (card.run?.status === "awaiting_merge") return "pr_ready";
  return column === "todo" ? "open" : "in_progress";
}

/** Due date first (soonest, undated last), then priority, then board order. */
function byUrgency(a: { card: BoardCard; index: number }, b: { card: BoardCard; index: number }) {
  if (a.card.dueDate !== b.card.dueDate) {
    if (!a.card.dueDate) return 1;
    if (!b.card.dueDate) return -1;
    return a.card.dueDate < b.card.dueDate ? -1 : 1;
  }
  const priority = ISSUE_PRIORITIES.indexOf(a.card.priority) - ISSUE_PRIORITIES.indexOf(b.card.priority);
  return priority || a.index - b.index;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export async function getOverviewData(workspace: Pick<Workspace, "id" | "name" | "aiProvider" | "agentMergeMode">, viewerId: number): Promise<OverviewData> {
  const [board, team, activity] = await Promise.all([
    getBoardData(workspace),
    getTeamOverview(workspace),
    getActivityFeed(workspace, { limit: RECENT_ACTIVITY_LIMIT, viewerId, kinds: WORK_ACTIVITY_KINDS }),
  ]);

  // Every card that isn't done, in board order (columns left to right, then position).
  const open = (Object.entries(board.columns) as [BoardColumnId, string[]][])
    .filter(([column]) => column !== "done")
    .flatMap(([column, ids]) => ids.map((id) => ({ card: board.cards[id]!, column })))
    .map((entry, index) => ({ ...entry, index }));

  const today = new Date();
  const weekEnd = addDays(today, 7);
  const overdue = open.filter(({ card }) => card.dueDate && differenceInCalendarDays(parseISO(card.dueDate), today) < 0).length;
  const dueThisWeek = open.filter(({ card }) => {
    if (!card.dueDate) return false;
    const due = parseISO(card.dueDate);
    return differenceInCalendarDays(due, today) >= 0 && differenceInCalendarDays(due, weekEnd) <= 0;
  }).length;

  const inProgress = open.filter(({ column }) => IN_PROGRESS_COLUMNS.includes(column));
  const agentsWorking = new Set(inProgress.flatMap(({ card }) => (card.assignee ? [card.assignee.name] : []))).size;
  const prReady = open.filter(({ card }) => card.run?.status === "awaiting_merge").length;

  return {
    stats: {
      open: {
        count: open.length,
        hint:
          open.length === 0
            ? "Nothing on the board yet"
            : overdue
              ? `${overdue} overdue`
              : dueThisWeek
                ? `${dueThisWeek} due this week`
                : "None due this week",
      },
      inProgress: {
        count: inProgress.length,
        hint:
          inProgress.length === 0
            ? "No agent is working on a card"
            : agentsWorking
              ? `Across ${plural(agentsWorking, "agent")}`
              : "Not assigned to an agent",
      },
      prReady: {
        count: prReady,
        hint: prReady ? "Waiting for you to merge" : "Nothing waiting for you",
      },
    },
    upcomingTasks: [...open]
      .sort(byUrgency)
      .slice(0, UPCOMING_LIMIT)
      .map(({ card, column }) => ({
        id: card.id,
        key: card.key,
        title: card.title,
        type: card.type,
        status: taskStatus(card, column),
        column,
        priority: card.priority,
        dueDate: card.dueDate,
        labels: card.labels,
        run: card.run,
        githubIssueNumber: card.github?.number ?? null,
      })),
    team,
    recentActivity: activity.items,
  };
}
