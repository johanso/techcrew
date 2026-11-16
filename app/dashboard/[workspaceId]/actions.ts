"use server";

import { getTeamOverview, type TeamOverview } from "@/lib/agents";
import { requireUser } from "@/lib/current-user";
import { listNotifications, markNotificationsRead, type NotificationList } from "@/lib/notifications";
import { getOwnedWorkspace } from "@/lib/workspaces";

async function authorize(workspaceId: number) {
  const user = await requireUser(`/dashboard/${workspaceId}`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  return workspace ? { user, workspace } : null;
}

/** Live team status, polled by the AI Team page (cards, live process) and the Overview's AI team card while the page is open. Read-only. */
export async function getTeamStatusAction(workspaceId: number): Promise<TeamOverview | null> {
  const auth = await authorize(workspaceId);
  return auth ? getTeamOverview(auth.workspace) : null;
}

/** The header bell's notifications (polled). */
export async function getNotificationsAction(workspaceId: number): Promise<NotificationList | null> {
  const auth = await authorize(workspaceId);
  return auth ? listNotifications(auth.workspace.id, auth.user.id) : null;
}

/** Marks the given notifications (or all, without ids) as read. Ids are re-scoped to the user and workspace. */
export async function markNotificationsReadAction(workspaceId: number, ids?: unknown): Promise<{ ok: boolean }> {
  const auth = await authorize(workspaceId);
  if (!auth) return { ok: false };
  const valid = Array.isArray(ids) ? ids.filter((id): id is number => Number.isSafeInteger(id)) : undefined;
  await markNotificationsRead(auth.workspace.id, auth.user.id, valid);
  return { ok: true };
}
