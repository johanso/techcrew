import "server-only";

import { and, eq, inArray, max, min } from "drizzle-orm";

import { db, tasks, workspaces, type Workspace } from "@/db";
import { cleanLabels } from "@/lib/board";
import { DESCRIPTION_MAX, type IssuePriority, type IssueType } from "@/lib/board-config";
import { GithubError, getGithubToken, listRepoIssues, type GithubIssue } from "@/lib/github";

/**
 * Pulls the linked repository's GitHub issues onto the workspace's board.
 *
 * Ownership rules (so a sync never silently undoes someone's work):
 * - GitHub owns title, description, labels and open/closed state — refreshed whenever the issue changes.
 * - The board owns column, type, priority and due date — set once on import, then never touched by a sync,
 *   except that closing an issue moves its card to Done and reopening one moves it back to Todo.
 * - A card removed from the board stays removed: its tombstone row keeps the issue from being imported again.
 */

export type SyncCounts = { added: number; updated: number; closed: number; reopened: number };

export type SyncResult =
  | ({ ok: true; syncedAt: string } & SyncCounts)
  | { ok: false; reason: "not_connected" | "reconnect" | "no_access" | "error" };

// GitHub's `since` is "updated at or after"; re-reading a minute of overlap covers clock skew. Re-applying is a no-op.
const SINCE_OVERLAP_MS = 60_000;

/** Initial type from conventional labels ("bug", "enhancement", "feature" …). */
export function typeFromLabels(labels: string[]): IssueType {
  const names = labels.map((l) => l.toLowerCase());
  if (names.some((l) => /\b(bug|defect|regression|crash)\b/.test(l))) return "bug";
  if (names.some((l) => /\b(feature|enhancement|feature request)\b/.test(l))) return "feature";
  return "issue";
}

/** Initial priority from labels like "urgent", "p1", "priority: high". */
export function priorityFromLabels(labels: string[]): IssuePriority {
  const names = labels.map((l) => l.toLowerCase());
  if (names.some((l) => /\b(p0|urgent|critical|blocker)\b/.test(l))) return "urgent";
  if (names.some((l) => /\b(p1|high)\b/.test(l))) return "high";
  if (names.some((l) => /\b(p3|p4|low|minor)\b/.test(l))) return "low";
  return "medium";
}

function contentOf(issue: GithubIssue) {
  return {
    title: issue.title.trim() || `Issue #${issue.number}`,
    description: issue.body.slice(0, DESCRIPTION_MAX),
    labels: cleanLabels(issue.labels),
    githubIssueUrl: issue.url,
    githubIssueState: issue.state,
    githubUpdatedAt: new Date(issue.updatedAt),
  };
}

type SyncWorkspace = Pick<Workspace, "id" | "ownerId" | "githubRepoFullName" | "githubIssuesSyncedAt">;

export async function syncWorkspaceIssues(workspace: SyncWorkspace): Promise<SyncResult> {
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return { ok: false, reason: "not_connected" };

  // Network first, outside the transaction, so the workspace lock is held only while writing.
  const startedAt = new Date();
  let issues: GithubIssue[];
  try {
    issues = await listRepoIssues(token, workspace.githubRepoFullName, workspace.githubIssuesSyncedAt);
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) return { ok: false, reason: "reconnect" };
    if (error instanceof GithubError && (error.status === 403 || error.status === 404)) return { ok: false, reason: "no_access" };
    console.error("[github] issue sync failed", error);
    return { ok: false, reason: "error" };
  }

  const counts: SyncCounts = { added: 0, updated: 0, closed: 0, reopened: 0 };

  await db.transaction(async (tx) => {
    // Same lock as card creation: serializes numbering and concurrent syncs of this workspace.
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspace.id)).for("update");

    const existing = issues.length
      ? await tx
          .select({
            id: tasks.id,
            githubIssueId: tasks.githubIssueId,
            status: tasks.status,
            githubIssueState: tasks.githubIssueState,
            githubUpdatedAt: tasks.githubUpdatedAt,
            removedAt: tasks.removedAt,
          })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspace.id), inArray(tasks.githubIssueId, issues.map((i) => i.id))))
      : [];
    const byIssueId = new Map(existing.map((row) => [row.githubIssueId, row]));

    const scope = eq(tasks.workspaceId, workspace.id);
    let [{ lastNumber }] = await tx.select({ lastNumber: max(tasks.number) }).from(tasks).where(scope);
    let [{ todoTop }] = await tx.select({ todoTop: min(tasks.position) }).from(tasks).where(and(scope, eq(tasks.status, "todo")));
    let [{ doneBottom }] = await tx.select({ doneBottom: max(tasks.position) }).from(tasks).where(and(scope, eq(tasks.status, "done")));
    const nextTodoTop = () => (todoTop = (todoTop ?? 1) - 1);
    const nextDoneBottom = () => (doneBottom = (doneBottom ?? -1) + 1);

    // Oldest first, so with "new cards on top" the most recent issue ends up first in Todo.
    for (const issue of [...issues].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const row = byIssueId.get(issue.id);

      if (!row) {
        // Closed issues that were never on the board aren't worth importing.
        if (issue.state === "closed") continue;
        lastNumber = (lastNumber ?? 0) + 1;
        await tx.insert(tasks).values({
          ...contentOf(issue),
          workspaceId: workspace.id,
          number: lastNumber,
          type: typeFromLabels(issue.labels),
          priority: priorityFromLabels(issue.labels),
          status: "todo",
          position: nextTodoTop(),
          githubIssueId: issue.id,
          githubIssueNumber: issue.number,
        });
        counts.added++;
        continue;
      }

      // Removed from the board by the user: leave it off, whatever happens to the issue.
      if (row.removedAt) continue;

      const changed = !row.githubUpdatedAt || new Date(issue.updatedAt) > row.githubUpdatedAt;
      if (!changed) continue;

      const move: { status?: string; position?: number } = {};
      if (issue.state === "closed" && row.githubIssueState !== "closed" && row.status !== "done") {
        Object.assign(move, { status: "done", position: nextDoneBottom() });
        counts.closed++;
      } else if (issue.state === "open" && row.githubIssueState === "closed" && row.status === "done") {
        Object.assign(move, { status: "todo", position: nextTodoTop() });
        counts.reopened++;
      } else {
        counts.updated++;
      }
      await tx
        .update(tasks)
        .set({ ...contentOf(issue), ...move, updatedAt: new Date() })
        .where(eq(tasks.id, row.id));
    }

    await tx
      .update(workspaces)
      .set({ githubIssuesSyncedAt: new Date(startedAt.getTime() - SINCE_OVERLAP_MS) })
      .where(eq(workspaces.id, workspace.id));
  });

  return { ok: true, syncedAt: startedAt.toISOString(), ...counts };
}
