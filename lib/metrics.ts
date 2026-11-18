import "server-only";

import { and, desc, eq, gte, inArray, like, sql } from "drizzle-orm";

import { agentActivity, agentRunSteps, agentRuns, agents, db, pullRequests, tasks, type Workspace } from "@/db";
import { AGENT_KEYS, type AgentKey } from "@/lib/agent-config";
import { isRunStatus, type RunStatus } from "@/lib/agent-run-config";
import { taskKeyPrefix } from "@/lib/agents";
import { summarizeRuns, type MetricPeriod, type MetricRun, type RunMetrics } from "@/lib/run-metrics";

/** Runs listed under the charts. */
const RECENT_RUNS = 15;

export type RecentRun = {
  id: number;
  taskId: number;
  key: string;
  title: string;
  status: RunStatus;
  reworkRounds: number;
  costMicros: number;
  startedAt: Date;
  pullRequest: { number: number; url: string } | null;
};

export type WorkspaceMetrics = {
  days: MetricPeriod;
  summary: RunMetrics;
  /** Pipeline spend per agent in the period (the agents' task_run activity), highest first; agents with none left out. */
  costByAgent: { agent: AgentKey; costMicros: number }[];
  recent: RecentRun[];
};

/** How the agent pipeline did on the runs started in the last `days` days. */
export async function getWorkspaceMetrics(workspace: Pick<Workspace, "id" | "name">, days: MetricPeriod): Promise<WorkspaceMetrics> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      id: agentRuns.id,
      taskId: agentRuns.taskId,
      status: agentRuns.status,
      reworkRounds: agentRuns.reworkRounds,
      costMicros: agentRuns.costMicros,
      ci: agentRuns.ci,
      startedAt: agentRuns.startedAt,
      number: tasks.number,
      title: tasks.title,
      prNumber: pullRequests.number,
      prUrl: pullRequests.url,
    })
    .from(agentRuns)
    .innerJoin(tasks, eq(tasks.id, agentRuns.taskId))
    .leftJoin(pullRequests, eq(pullRequests.runId, agentRuns.id))
    .where(and(eq(agentRuns.workspaceId, workspace.id), gte(agentRuns.startedAt, since)))
    .orderBy(desc(agentRuns.id));
  const runs = rows.flatMap((row) => (isRunStatus(row.status) ? [{ ...row, status: row.status }] : []));

  // Rounds the Lead sent back: its stage results say so in the agent log ("Sent ACM-12 back to the developer").
  const sentBack = runs.length
    ? await db
        .select({ runId: agentRunSteps.runId, round: agentRunSteps.round })
        .from(agentRunSteps)
        .where(
          and(
            inArray(agentRunSteps.runId, runs.map((run) => run.id)),
            eq(agentRunSteps.stage, "approval"),
            eq(agentRunSteps.tool, "result"),
            like(agentRunSteps.summary, "Sent % back to the developer%")
          )
        )
    : [];
  const metricRuns: MetricRun[] = runs.map((run) => ({
    status: run.status,
    reworkRounds: run.reworkRounds,
    costMicros: run.costMicros,
    ci: run.ci,
    leadSentBack: sentBack.filter((s) => s.runId === run.id).map((s) => s.round),
  }));

  const spend = await db
    .select({ key: agents.key, costMicros: sql<number>`coalesce(sum(${agentActivity.costMicros}), 0)::int` })
    .from(agentActivity)
    .innerJoin(agents, eq(agents.id, agentActivity.agentId))
    .where(and(eq(agentActivity.workspaceId, workspace.id), eq(agentActivity.kind, "task_run"), gte(agentActivity.createdAt, since)))
    .groupBy(agents.key);
  const costByAgent = spend
    .flatMap((row) => ((AGENT_KEYS as readonly string[]).includes(row.key) && row.costMicros > 0 ? [{ agent: row.key as AgentKey, costMicros: row.costMicros }] : []))
    .sort((a, b) => b.costMicros - a.costMicros);

  const prefix = taskKeyPrefix(workspace.name);
  return {
    days,
    summary: summarizeRuns(metricRuns),
    costByAgent,
    recent: runs.slice(0, RECENT_RUNS).map((run) => ({
      id: run.id,
      taskId: run.taskId,
      key: `${prefix}-${run.number}`,
      title: run.title,
      status: run.status,
      reworkRounds: run.reworkRounds,
      costMicros: run.costMicros,
      startedAt: run.startedAt,
      pullRequest: run.prNumber !== null && run.prUrl ? { number: run.prNumber, url: run.prUrl } : null,
    })),
  };
}
