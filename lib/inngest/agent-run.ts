import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, tasks } from "@/db";
import { inngest } from "@/lib/inngest/client";

/** Sent by the board's Run action; the card is assigned to the agent right after. */
export const AGENT_TASK_RUN = "agent/task.run";

export type AgentTaskRunData = { workspaceId: number; taskId: number; agentId: string };

/**
 * Starts an agent on a board card.
 *
 * ⚠️ PLACEHOLDER. There is no agent runtime yet: this only checks that the card is still on the board, then
 * logs. The analyst's real work (reading the task and the repo with the owner's GitHub token,
 * `getGithubToken(workspace.ownerId)`) goes in the `analyze` step.
 */
export const agentTaskRun = inngest.createFunction(
  // One run per card at a time; a second Run while one is going waits for it.
  { id: "agent-task-run", name: "Agent: run a board task", retries: 2, concurrency: { key: "event.data.taskId", limit: 1 } },
  { event: AGENT_TASK_RUN },
  async ({ event, step }) => {
    const { workspaceId, taskId, agentId } = event.data as AgentTaskRunData;

    const task = await step.run("load-task", async () => {
      const [row] = await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.removedAt)));
      return row ?? null;
    });
    // Removed since Run was pressed: nothing to do.
    if (!task) return { started: false };

    await step.run("analyze", async () => {
      console.log(`[agent:${agentId}] picked up task ${task.id}: ${task.title}`);
    });
    return { started: true };
  }
);
