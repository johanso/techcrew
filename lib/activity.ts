import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { agentActivity, agents, db, taskEvents, tasks, users, type Workspace } from "@/db";
import { getAgent, taskKeyPrefix, type Agent, type AgentActivityKind } from "@/lib/agents";
import { TASK_EVENT_KINDS, type TaskEventKind } from "@/lib/task-events";

/**
 * The workspace timeline: everything the agents logged (`agent_activity`), the cards people created on the board,
 * and what people did to cards (`task_events`: moved, edited, removed). Shown on the Activity page (all of it) and in the Overview's recent activity (work only).
 */

export type ActivityKind = AgentActivityKind | TaskEventKind | "task_created";

const isTaskEventKind = (kind: ActivityKind): kind is TaskEventKind => (TASK_EVENT_KINDS as readonly string[]).includes(kind);

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  /** `isViewer`: the signed-in user, shown as "You". */
  actor: { type: "agent"; agent: Agent } | { type: "user"; name: string; isViewer: boolean };
  /** What happened, e.g. "Opened PR #3". */
  title: string;
  /** Context, e.g. the card or pull request title, or why a run stopped. */
  detail: string | null;
  /** Model spend of this event in micro-dollars (0 when it cost nothing). */
  costMicros: number;
  at: Date;
};

/** Work on cards. The rest (joined, configured, paused, scans …) is team setup, left out of the Overview. */
export const WORK_ACTIVITY_KINDS: ActivityKind[] = ["task_created", "task_moved", "task_assigned", "task_run", "pull_request", "issue_filed"];

export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_MAX = 500;

/**
 * Newest `limit` events of the workspace. `viewerId` marks the viewer's own events.
 * `kinds` narrows the feed (default: every kind).
 */
export async function getActivityFeed(
  workspace: Pick<Workspace, "id" | "name">,
  { limit, viewerId, kinds }: { limit: number; viewerId: number; kinds?: ActivityKind[] }
): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const agentKinds = kinds?.filter((kind): kind is AgentActivityKind => kind !== "task_created" && !isTaskEventKind(kind));
  const eventKinds = kinds ? kinds.filter(isTaskEventKind) : [...TASK_EVENT_KINDS];
  const withCreated = !kinds || kinds.includes("task_created");
  const prefix = taskKeyPrefix(workspace.name);

  // Each source returns limit + 1 so we know whether anything older is left after merging.
  const [agentRows, createdRows, eventRows] = await Promise.all([
    agentKinds?.length === 0
      ? []
      : db
          .select({
            id: agentActivity.id,
            key: agents.key,
            kind: agentActivity.kind,
            title: agentActivity.title,
            detail: agentActivity.detail,
            costMicros: agentActivity.costMicros,
            at: agentActivity.createdAt,
          })
          .from(agentActivity)
          .innerJoin(agents, eq(agents.id, agentActivity.agentId))
          .where(
            and(eq(agentActivity.workspaceId, workspace.id), agentKinds ? inArray(agentActivity.kind, agentKinds) : undefined)
          )
          .orderBy(desc(agentActivity.createdAt), desc(agentActivity.id))
          .limit(limit + 1),
    withCreated
      ? db
          .select({
            id: tasks.id,
            number: tasks.number,
            title: tasks.title,
            userId: users.id,
            userName: users.name,
            at: tasks.createdAt,
          })
          .from(tasks)
          .innerJoin(users, eq(users.id, tasks.createdById))
          // Cards made by people in the app; imported GitHub issues and agent-filed cards have no creator.
          .where(and(eq(tasks.workspaceId, workspace.id), isNotNull(tasks.createdById)))
          .orderBy(desc(tasks.createdAt), desc(tasks.id))
          .limit(limit + 1)
      : [],
    eventKinds.length
      ? db
          .select({
            id: taskEvents.id,
            kind: taskEvents.kind,
            title: taskEvents.title,
            detail: taskEvents.detail,
            userId: taskEvents.userId,
            userName: users.name,
            at: taskEvents.createdAt,
          })
          .from(taskEvents)
          .leftJoin(users, eq(users.id, taskEvents.userId))
          .where(and(eq(taskEvents.workspaceId, workspace.id), inArray(taskEvents.kind, eventKinds)))
          .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id))
          .limit(limit + 1)
      : [],
  ]);

  const items: ActivityItem[] = [];
  for (const row of agentRows) {
    const agent = getAgent(row.key);
    if (!agent) continue;
    items.push({
      id: `a${row.id}`,
      kind: row.kind as AgentActivityKind,
      actor: { type: "agent", agent },
      title: row.title,
      detail: row.detail,
      costMicros: row.costMicros,
      at: row.at,
    });
  }
  for (const row of createdRows) {
    items.push({
      id: `t${row.id}`,
      kind: "task_created",
      actor: { type: "user", name: row.userName ?? "A teammate", isViewer: row.userId === viewerId },
      title: `Created ${prefix}-${row.number}`,
      detail: row.title,
      costMicros: 0,
      at: row.at,
    });
  }

  for (const row of eventRows) {
    items.push({
      id: `e${row.id}`,
      kind: row.kind as TaskEventKind,
      actor: { type: "user", name: row.userName ?? "A teammate", isViewer: row.userId === viewerId },
      title: row.title,
      detail: row.detail,
      costMicros: 0,
      at: row.at,
    });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}
