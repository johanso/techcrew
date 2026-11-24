import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, workspaces } from "@/db";
import { planProvidersHere } from "@/lib/agent-pipeline";
import { isSimulatedAgents } from "@/lib/agent-simulated";
import { getOwnerAIKeys } from "@/lib/ai-keys";
import { setupSteps, type AiRoute } from "@/lib/setup-status";

/**
 * The "Get started" steps for a signed-in user (lib/setup-status.ts). `workspaceId` is the workspace being viewed, if
 * any; without it the user's own newest workspace is used for the Settings link. Only whether a route exists leaves
 * this function: never a key, never its source.
 */
export async function getSetupStatus(userId: number, workspaceId: number | null = null) {
  const [owned] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(workspaceId === null ? eq(workspaces.ownerId, userId) : and(eq(workspaces.ownerId, userId), eq(workspaces.id, workspaceId)))
    .orderBy(asc(workspaces.id))
    .limit(1);
  return setupSteps({ workspaceId: owned?.id ?? null, ownsWorkspace: owned !== undefined, aiRoute: await aiRouteHere(userId) });
}

async function aiRouteHere(userId: number): Promise<AiRoute | null> {
  if (isSimulatedAgents()) return "simulated";
  const keys = await getOwnerAIKeys(userId);
  if (Object.values(keys).some(Boolean)) return "key";
  // Only asked without a key: it looks for Claude Code on this computer.
  const plans = await planProvidersHere({ ownerId: userId });
  return Object.values(plans).some(Boolean) ? "plan" : null;
}
