import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, notifications, workspaces } from "@/db";

/**
 * Header bell notifications. The pipeline and the merge path call notify() at the moments that need the owner:
 * a pull request waits for them, the analyst has a question, a run stopped, the provider ran out of credit.
 */

export const NOTIFICATION_KINDS = [
  "pr_ready",
  "merged",
  "merge_blocked",
  "needs_info",
  "run_failed",
  "out_of_credit",
  "provider_switched",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationView = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  /** ISO time. */
  at: string;
};

const LIST_LIMIT = 30;

/** Board link that opens a card's agent log. */
export const agentLogHref = (workspaceId: number, taskId: number) => `/dashboard/${workspaceId}/board?log=${taskId}`;

/**
 * Notifies the workspace's owner. Never throws: a notification that fails to save must not fail the pipeline step
 * that sent it (the step would retry and redo its work).
 */
export async function notify(
  workspaceId: number,
  input: { kind: NotificationKind; title: string; body?: string | null; href?: string | null; taskId?: number | null }
) {
  try {
    const [workspace] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!workspace) return;
    await db.insert(notifications).values({
      workspaceId,
      userId: workspace.ownerId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      taskId: input.taskId ?? null,
    });
  } catch (error) {
    console.error("[notifications] not saved", error);
  }
}

/** The user's latest notifications in this workspace, newest first, with the unread count. */
export async function listNotifications(workspaceId: number, userId: number) {
  const scope = and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, userId));
  const [rows, [unread]] = await Promise.all([
    db.select().from(notifications).where(scope).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(LIST_LIMIT),
    db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(scope, isNull(notifications.readAt))),
  ]);
  const items: NotificationView[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    read: row.readAt !== null,
    at: row.createdAt.toISOString(),
  }));
  return { items, unread: unread?.count ?? 0 };
}

export type NotificationList = Awaited<ReturnType<typeof listNotifications>>;

/** Marks some (ids) or all of the user's unread notifications in this workspace as read. */
export async function markNotificationsRead(workspaceId: number, userId: number, ids?: number[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined
      )
    );
}
