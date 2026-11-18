import "server-only";

import { eq } from "drizzle-orm";

import { db, tasks, workspaces } from "@/db";
import { pipelineModelProblem } from "@/lib/agent-pipeline";
import { createRun, findAutoPickupCandidates } from "@/lib/agent-runs";
import { checkAgentCanRun, logAgentActivity, taskKeyPrefix } from "@/lib/agents";
import { inngest } from "@/lib/inngest/client";
import { AGENT_TASK_RUN, type AgentTaskRunData } from "@/lib/inngest/agent-run";

/**
 * Auto pickup (Settings → Agents): every two minutes, the analyst takes the top Todo card that was never run, in
 * each workspace that has it on and no run in flight. One card at a time per workspace keeps spend predictable.
 */
export const agentAutoPickup = inngest.createFunction(
  { id: "agent-auto-pickup", name: "Agents: pick up Todo cards" },
  { cron: "*/2 * * * *" },
  async ({ step }) => {
    const runs = await step.run("start-runs", async () => {
      const started: AgentTaskRunData[] = [];
      for (const pick of await findAutoPickupCandidates()) {
        // Paused or over-budget analysts skip their turn; the card waits for the next tick.
        const allowed = await checkAgentCanRun(pick.workspaceId, "analyst");
        if (!allowed.ok) continue;
        // No key for an agent's model (Settings → AI providers): don't start a run that would stop halfway.
        if (await pipelineModelProblem(pick.workspaceId)) continue;
        const run = await createRun({ workspaceId: pick.workspaceId, taskId: pick.taskId, trigger: "auto" });
        started.push({ workspaceId: pick.workspaceId, taskId: pick.taskId, runId: run.id });
        // Like Run on the board, the activity feed says who took the card; here nobody clicked, so it says why.
        const [card] = await db
          .select({ number: tasks.number, title: tasks.title, workspace: workspaces.name })
          .from(tasks)
          .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
          .where(eq(tasks.id, pick.taskId));
        if (card) {
          await logAgentActivity({
            workspaceId: pick.workspaceId,
            agentId: allowed.row.id,
            kind: "task_assigned",
            title: `Picked up ${taskKeyPrefix(card.workspace)}-${card.number}`,
            detail: `${card.title} (auto pickup)`,
            taskId: pick.taskId,
          }).catch((error) => console.error("[pickup] activity not logged", error));
        }
      }
      return started;
    });
    if (runs.length) await step.sendEvent("queue-runs", runs.map((data) => ({ name: AGENT_TASK_RUN, data })));
    return { started: runs.length };
  }
);
