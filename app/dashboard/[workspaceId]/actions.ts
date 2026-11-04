"use server";

import { getTeamOverview, type TeamOverview } from "@/lib/agents";
import { requireUser } from "@/lib/current-user";
import { getOwnedWorkspace } from "@/lib/workspaces";

/** Live team status, polled by the office and the AI team card while the page is open. Read-only. */
export async function getTeamStatusAction(workspaceId: number): Promise<TeamOverview | null> {
  const user = await requireUser(`/dashboard/${workspaceId}`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  return workspace ? getTeamOverview(workspace) : null;
}
