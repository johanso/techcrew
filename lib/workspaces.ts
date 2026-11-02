import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { db, workspaces, type NewWorkspace } from "@/db";
import { requireUser } from "@/lib/current-user";

export function listWorkspaces(ownerId: number) {
  return db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).orderBy(desc(workspaces.createdAt));
}

export async function hasWorkspaces(ownerId: number) {
  const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  return Boolean(row);
}

/** The workspace only if `ownerId` owns it — use for every id that comes from a request. */
export async function getOwnedWorkspace(ownerId: number, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, ownerId)));
  return row ?? null;
}

export async function insertWorkspace(values: NewWorkspace) {
  const [row] = await db.insert(workspaces).values(values).returning();
  return row!;
}

/**
 * Everything a /dashboard/[workspaceId] route needs: the signed-in user, the workspace from the
 * URL (404 unless they own it) and all their workspaces for the switcher. Deduplicated per request,
 * so the layout and the page share one lookup.
 */
export const getDashboardContext = cache(async (workspaceIdParam: string) => {
  const user = await requireUser(`/dashboard/${workspaceIdParam}`);
  const all = await listWorkspaces(user.id);
  const workspace = all.find((w) => String(w.id) === workspaceIdParam);
  if (!workspace) notFound();
  return { user, workspace, workspaces: all };
});
