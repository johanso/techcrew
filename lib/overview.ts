import "server-only";

import type { Workspace } from "@/db";
import { getAgent, taskKeyPrefix, type Agent } from "@/lib/agents";

// Fixture actors: the workspace's real agent roles, doing made-up work.
const AGENTS = {
  analyst: getAgent("analyst")!,
  developer: getAgent("developer")!,
  reviewer: getAgent("reviewer")!,
  tester: getAgent("tester")!,
};
import type { IssuePriority } from "@/lib/board-config";

/**
 * Data for the workspace Overview page.
 *
 * ⚠️ DUMMY DATA. There are no tasks, agents or activity tables yet. The types below are the
 * contract the UI renders; when real data lands, replace the body of `getOverviewData` with
 * queries and keep the return shape. Nothing else needs to change.
 */

export type TaskStatus = "open" | "in_progress" | "pr_ready";
export type TaskPriority = IssuePriority;

export type UpcomingTask = {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date;
  assignee: Agent | null;
  labels: string[];
};

export type ActivityKind = "task_completed" | "pr_opened" | "commits_pushed" | "review_requested" | "task_assigned" | "task_created";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  actor: { type: "agent"; agent: Agent } | { type: "user"; name: string };
  /** Short predicate, e.g. "opened a pull request". */
  action: string;
  /** What the action was about, e.g. a task or branch name. */
  target: string;
  at: Date;
};

export type OverviewStat = { count: number; hint: string };

export type OverviewData = {
  stats: { open: OverviewStat; inProgress: OverviewStat; prReady: OverviewStat };
  upcomingTasks: UpcomingTask[];
  recentActivity: ActivityItem[];
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function getOverviewData(workspace: Pick<Workspace, "id" | "name">, userName: string | null): Promise<OverviewData> {
  // Relative to "now" so due dates and timestamps always read naturally.
  const now = Date.now();
  const prefix = taskKeyPrefix(workspace.name);
  const you = userName?.split(" ")[0] ?? "You";

  return {
    stats: {
      open: { count: 12, hint: "4 due this week" },
      inProgress: { count: 5, hint: "Across 3 agents" },
      prReady: { count: 3, hint: "Waiting for your review" },
    },
    upcomingTasks: [
      {
        id: "t1",
        key: `${prefix}-142`,
        title: "Add OAuth error states to the sign-in form",
        status: "in_progress",
        priority: "high",
        dueAt: new Date(now + 5 * HOUR),
        assignee: AGENTS.developer,
        labels: ["auth", "ui"],
      },
      {
        id: "t2",
        key: `${prefix}-139`,
        title: "Rate-limit the GitHub repository listing endpoint",
        status: "pr_ready",
        priority: "high",
        dueAt: new Date(now + 1 * DAY),
        assignee: AGENTS.developer,
        labels: ["api"],
      },
      {
        id: "t3",
        key: `${prefix}-147`,
        title: "Write end-to-end tests for workspace creation",
        status: "open",
        priority: "medium",
        dueAt: new Date(now + 2 * DAY),
        assignee: AGENTS.tester,
        labels: ["testing"],
      },
      {
        id: "t4",
        key: `${prefix}-151`,
        title: "Set up preview deployments for pull requests",
        status: "open",
        priority: "medium",
        dueAt: new Date(now + 4 * DAY),
        assignee: AGENTS.analyst,
        labels: ["ci"],
      },
      {
        id: "t5",
        key: `${prefix}-153`,
        title: "Document the workspace data model",
        status: "open",
        priority: "low",
        dueAt: new Date(now + 6 * DAY),
        assignee: null,
        labels: ["docs"],
      },
    ],
    recentActivity: [
      {
        id: "a1",
        kind: "pr_opened",
        actor: { type: "agent", agent: AGENTS.developer },
        action: "opened a pull request for",
        target: `${prefix}-139 Rate-limit the repository listing`,
        at: new Date(now - 18 * 60 * 1000),
      },
      {
        id: "a2",
        kind: "commits_pushed",
        actor: { type: "agent", agent: AGENTS.developer },
        action: "pushed 3 commits to",
        target: "feature/oauth-error-states",
        at: new Date(now - 52 * 60 * 1000),
      },
      {
        id: "a3",
        kind: "review_requested",
        actor: { type: "agent", agent: AGENTS.reviewer },
        action: "requested your review on",
        target: `${prefix}-136 Workspace switcher keeps section`,
        at: new Date(now - 3 * HOUR),
      },
      {
        id: "a4",
        kind: "task_completed",
        actor: { type: "agent", agent: AGENTS.tester },
        action: "completed",
        target: `${prefix}-131 Cache dependencies in CI`,
        at: new Date(now - 6 * HOUR),
      },
      {
        id: "a5",
        kind: "task_assigned",
        actor: { type: "user", name: you },
        action: "assigned Tester to",
        target: `${prefix}-147 End-to-end tests for workspace creation`,
        at: new Date(now - 1 * DAY - 2 * HOUR),
      },
      {
        id: "a6",
        kind: "task_created",
        actor: { type: "user", name: you },
        action: "created",
        target: `${prefix}-153 Document the workspace data model`,
        at: new Date(now - 2 * DAY),
      },
    ],
  };
}
