// Part of `npm run smoke`: starts one run the way the Run button does, by calling the app's own functions (checkAgentCanRun,
// createCardRun, the `agent/task.run` event, placeTask) instead of repeating their SQL. Vite loads the TypeScript with
// the same aliases Vitest uses (`@/` and the `server-only` stand-in). Not for any other use: it has no authorization of
// its own, so it only runs from the smoke script, in the smoke stack's environment (its temp database).
//   node scripts/smoke-start-run.mjs <workspaceId> <taskId>   -> prints {"runId": n} on its last line
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [workspaceId, taskId] = process.argv.slice(2).map(Number);
if (!Number.isSafeInteger(workspaceId) || !Number.isSafeInteger(taskId)) {
  console.error("Usage: node scripts/smoke-start-run.mjs <workspaceId> <taskId>");
  process.exit(2);
}
if (process.env.AGENTS_SIMULATED !== "true" || !process.env.TECHTEAM_DATA_DIR) {
  console.error("Refusing to run outside the smoke stack (AGENTS_SIMULATED and TECHTEAM_DATA_DIR are not set).");
  process.exit(2);
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": root, "server-only": path.join(root, "test", "server-only.ts") } },
});

try {
  const load = (file) => server.ssrLoadModule(file);
  const { db, workspaces } = await load("/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const { RUN_AGENT_ID, checkAgentCanRun, logAgentActivity } = await load("/lib/agents.ts");
  const { placeTask, finishRun } = await load("/lib/agent-runs.ts");
  const { createCardRun } = await load("/lib/pull-requests.ts");
  const { pipelineModelProblem } = await load("/lib/agent-pipeline.ts");
  const { inngest } = await load("/lib/inngest/client.ts");
  const { AGENT_TASK_RUN } = await load("/lib/inngest/agent-run.ts");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found.`);

  const allowed = await checkAgentCanRun(workspace.id, RUN_AGENT_ID, { onPlan: false });
  if (!allowed.ok) throw new Error(allowed.error);
  const modelProblem = await pipelineModelProblem(workspace.id);
  if (modelProblem) throw new Error(modelProblem);
  const created = await createCardRun(workspace, { taskId, trigger: "manual", createdById: workspace.ownerId });
  if (!created.ok) throw new Error(created.error);
  try {
    await inngest.send({ name: AGENT_TASK_RUN, data: { workspaceId: workspace.id, taskId, runId: created.runId } });
  } catch (error) {
    await finishRun(created.runId, "failed", "The run couldn't be queued.");
    throw error;
  }
  await placeTask(workspace.id, taskId, "analysis", RUN_AGENT_ID);
  await logAgentActivity({ workspaceId: workspace.id, agentId: allowed.row.id, kind: "task_assigned", title: "Assigned by the smoke test", detail: "", taskId });
  console.log(JSON.stringify({ runId: created.runId }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await server.close();
  // The app's database client keeps the process open.
  process.exit(process.exitCode ?? 0);
}
