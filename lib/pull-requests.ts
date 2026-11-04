import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { agentRuns, db, pullRequests, tasks, workspaces, type PullRequestRow, type Workspace } from "@/db";
import { isActiveRun, type RunStatus } from "@/lib/agent-run-config";
import { finishRun, placeTask } from "@/lib/agent-runs";
import { getAgentRow, logAgentActivity, taskKeyPrefix } from "@/lib/agents";
import { createAgentTask } from "@/lib/board";
import { GithubError, createIssue, getCommitChecks, getGithubToken, getPullRequest, mergePullRequest } from "@/lib/github";
import { notify } from "@/lib/notifications";

/**
 * Agent pull requests: merging (automatically after review + tests, or from the Pull Requests page), the tester's
 * follow-up card when a merge is blocked by a conflict or a failing build, and keeping state in step with GitHub.
 */

type PrWorkspace = Pick<Workspace, "id" | "name" | "ownerId" | "githubRepoFullName">;

export type MergeOutcome =
  | { status: "merged" }
  /** Not decidable yet (mergeability being computed, checks running). */
  | { status: "pending"; reason: string }
  /** Conflict or failing build: the tester filed a follow-up card. */
  | { status: "blocked"; reason: string; followUpKey: string | null }
  | { status: "error"; reason: string };

async function loadWorkspace(workspaceId: number) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return row ?? null;
}

/** Merges an agent pull request if GitHub says it can be: mergeable and every check green. */
export async function mergeAgentPullRequest(pr: PullRequestRow): Promise<MergeOutcome> {
  const workspace = await loadWorkspace(pr.workspaceId);
  if (!workspace) return { status: "error", reason: "Workspace not found." };
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return { status: "error", reason: "Connect GitHub again to merge." };
  const repo = workspace.githubRepoFullName;

  try {
    const live = await getPullRequest(token, repo, pr.number);
    if (live.merged) {
      await completeMerge(workspace, pr);
      return { status: "merged" };
    }
    if (live.state === "closed") {
      await closeWithoutMerge(pr);
      return { status: "error", reason: "The pull request was closed on GitHub." };
    }
    if (live.mergeable === null) return { status: "pending", reason: "GitHub is still checking whether the pull request can be merged." };
    if (live.mergeable === false || live.mergeableState === "dirty") {
      return blockMerge(workspace, pr, `Merge conflict: ${pr.headBranch} conflicts with ${pr.baseBranch}.`);
    }

    const checks = await getCommitChecks(token, repo, live.headSha);
    if (checks.state === "failure") {
      const failed = checks.checks.filter((c) => c.status === "completed" && c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
      return blockMerge(
        workspace,
        pr,
        `Build failed: ${failed.map((c) => `${c.name} (${c.conclusion})`).join(", ")}.`,
        failed.map((c) => `- ${c.name}: ${c.conclusion}${c.url ? ` — ${c.url}` : ""}`).join("\n")
      );
    }
    if (checks.state === "pending") return { status: "pending", reason: "CI checks are still running." };

    await mergePullRequest(token, repo, pr.number, { title: `${pr.title} (#${pr.number})`, sha: live.headSha });
    await completeMerge(workspace, pr);
    return { status: "merged" };
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) return { status: "error", reason: "GitHub rejected the token. Reconnect GitHub." };
    // 405: not mergeable (e.g. branch protection), 409: the head moved under us.
    if (error instanceof GithubError && (error.status === 405 || error.status === 409)) {
      return blockMerge(workspace, pr, `GitHub refused the merge: ${error.message}`);
    }
    console.error("[pull-requests] merge failed", error);
    return { status: "error", reason: "The merge failed. Please try again." };
  }
}

async function completeMerge(workspace: PrWorkspace, pr: PullRequestRow) {
  const now = new Date();
  await db
    .update(pullRequests)
    .set({ state: "merged", mergedAt: now, mergeError: null, updatedAt: now })
    .where(eq(pullRequests.id, pr.id));
  if (pr.taskId) await placeTask(workspace.id, pr.taskId, "done", null);
  if (pr.runId) await finishRun(pr.runId, "completed");
  const tester = await getAgentRow(workspace.id, "tester");
  if (tester) {
    await logAgentActivity({
      workspaceId: workspace.id,
      agentId: tester.id,
      kind: "pull_request",
      title: `Merged PR #${pr.number}`,
      detail: pr.title,
      taskId: pr.taskId,
    });
  }
}

async function closeWithoutMerge(pr: PullRequestRow) {
  await db.update(pullRequests).set({ state: "closed", updatedAt: new Date() }).where(eq(pullRequests.id, pr.id));
  if (pr.runId) {
    const [run] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, pr.runId));
    if (run && (run.status === "awaiting_merge" || isActiveRun(run.status as RunStatus))) {
      await finishRun(pr.runId, "failed", "The pull request was closed on GitHub without merging.");
    }
  }
}

/**
 * The merge can't happen: the tester files a follow-up card in Todo (a GitHub issue too, with the
 * "File issues" skill) so the problem gets picked up like any other task. One follow-up per pull request.
 */
async function blockMerge(workspace: PrWorkspace, pr: PullRequestRow, reason: string, details = ""): Promise<MergeOutcome> {
  const prefix = taskKeyPrefix(workspace.name);
  let followUpKey: string | null = null;

  if (pr.followUpTaskId) {
    const [existing] = await db.select({ number: tasks.number }).from(tasks).where(eq(tasks.id, pr.followUpTaskId));
    followUpKey = existing ? `${prefix}-${existing.number}` : null;
  } else {
    const [origin] = pr.taskId ? await db.select({ number: tasks.number, title: tasks.title }).from(tasks).where(eq(tasks.id, pr.taskId)) : [];
    const originKey = origin ? `${prefix}-${origin.number}` : null;
    const title = `Fix merge of PR #${pr.number}: ${reason.split(":")[0]}`;
    const description = [
      `The Tester couldn't merge [PR #${pr.number}](${pr.url}) (\`${pr.headBranch}\` → \`${pr.baseBranch}\`)${originKey ? ` for ${originKey}` : ""}.`,
      `**Reason:** ${reason}`,
      details,
      `**Expected:** the branch merges cleanly into \`${pr.baseBranch}\` with every check passing.`,
      "Resolve the problem on the same branch (rebase or fix the build), then merge the pull request.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const tester = await getAgentRow(workspace.id, "tester");
    let github: Parameters<typeof createAgentTask>[1]["github"] = null;
    if (tester?.skills.includes("issues.create")) {
      const token = await getGithubToken(workspace.ownerId).catch(() => null);
      if (token) {
        github = await createIssue(token, workspace.githubRepoFullName, { title, body: `${description}\n\n_Filed by the TechTeam Tester agent._`, labels: ["bug"] }).catch(
          (error) => {
            console.warn("[pull-requests] follow-up issue not created on GitHub", error);
            return null;
          }
        );
      }
    }
    const created = await createAgentTask(workspace, { type: "bug", title, description, priority: "high", labels: ["bug", "merge"], github });
    followUpKey = `${prefix}-${created.number}`;
    await db.update(pullRequests).set({ followUpTaskId: created.id }).where(eq(pullRequests.id, pr.id));
    if (tester) {
      await logAgentActivity({
        workspaceId: workspace.id,
        agentId: tester.id,
        kind: "issue_filed",
        title: `Filed ${followUpKey}${github ? ` (issue #${github.number})` : ""}`,
        detail: reason,
        taskId: created.id,
      });
    }
  }

  await db.update(pullRequests).set({ mergeError: reason, updatedAt: new Date() }).where(eq(pullRequests.id, pr.id));
  if (pr.runId) await finishRun(pr.runId, "failed", `Merge blocked. ${reason}${followUpKey ? ` Follow-up: ${followUpKey}.` : ""}`);
  await notify(workspace.id, {
    kind: "merge_blocked",
    title: `PR #${pr.number} couldn't be merged`,
    body: `${reason}${followUpKey ? ` The Tester filed ${followUpKey} to fix it.` : ""}`,
    href: `/dashboard/${workspace.id}/pull-requests`,
    taskId: pr.taskId,
  });
  return { status: "blocked", reason, followUpKey };
}

/** The run's pull request (for the pipeline's auto-merge step). */
export async function getRunPullRequest(runId: number) {
  const [row] = await db.select().from(pullRequests).where(eq(pullRequests.runId, runId));
  return row ?? null;
}

/**
 * A rerun takes over the card's open pull request: the new run works on the same branch and PR, whose review and
 * test verdicts start over. (openPullRequest then finds it by run id and reuses it, as in a rework round.)
 */
export async function adoptPullRequest(pullRequestId: number, runId: number) {
  await db
    .update(pullRequests)
    .set({ runId, reviewStatus: "pending", testStatus: "pending", mergeError: null, updatedAt: new Date() })
    .where(eq(pullRequests.id, pullRequestId));
}

/** The newest open pull request of a board card (Merge on the card, reruns). */
export async function getTaskOpenPullRequest(workspaceId: number, taskId: number) {
  if (!Number.isSafeInteger(taskId)) return null;
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.workspaceId, workspaceId), eq(pullRequests.taskId, taskId), eq(pullRequests.state, "open")))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * A user's Merge (Pull Requests page or board card): only for PRs that passed review and tests, then the same checks
 * as auto-merge (mergeable, CI green). A conflict or failing build makes the Tester file a follow-up card instead.
 */
export async function mergeManually(pr: PullRequestRow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (pr.state !== "open") return { ok: false, error: "This pull request is no longer open." };
  if (pr.reviewStatus !== "approved" || pr.testStatus !== "passed") {
    return { ok: false, error: "Only pull requests that passed review and tests can be merged here. Merge others on GitHub." };
  }
  const outcome = await mergeAgentPullRequest(pr);
  switch (outcome.status) {
    case "merged":
      return { ok: true };
    case "pending":
      return { ok: false, error: `${outcome.reason} Try again in a moment.` };
    case "blocked":
      return { ok: false, error: `${outcome.reason}${outcome.followUpKey ? ` The Tester filed ${outcome.followUpKey} in Todo.` : ""}` };
    case "error":
      return { ok: false, error: outcome.reason };
  }
}

/** An owner-scoped pull request (for the Merge action). */
export async function getWorkspacePullRequest(workspaceId: number, id: number) {
  if (!Number.isSafeInteger(id)) return null;
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.workspaceId, workspaceId), eq(pullRequests.id, id)));
  return row ?? null;
}

/** Re-reads one open pull request on GitHub and applies a merge or close done there. Returns whether it's still open. */
async function refreshPullRequest(workspace: PrWorkspace, pr: PullRequestRow, token: string) {
  const live = await getPullRequest(token, workspace.githubRepoFullName, pr.number);
  if (live.merged) await completeMerge(workspace, pr);
  else if (live.state === "closed") await closeWithoutMerge(pr);
  return !live.merged && live.state !== "closed";
}

/**
 * Picks up merges and closes done on GitHub directly, so the page and board don't show stale state.
 * Returns how many pull requests changed (the board reloads when any did).
 */
export async function refreshOpenPullRequests(workspace: PrWorkspace) {
  const open = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.workspaceId, workspace.id), eq(pullRequests.state, "open")));
  if (!open.length) return 0;
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return 0;
  const stillOpen = await Promise.all(
    open.map(async (pr) => {
      try {
        return await refreshPullRequest(workspace, pr, token);
      } catch (error) {
        console.warn(`[pull-requests] refresh of #${pr.number} failed`, error);
        return true;
      }
    })
  );
  return stillOpen.filter((isOpen) => !isOpen).length;
}

/**
 * The card's open pull request for a rerun to continue on — checked on GitHub first, since it may have been closed or
 * merged there (that change is applied, and null returned, so the rerun starts a fresh branch).
 */
export async function getRerunPullRequest(workspace: PrWorkspace, taskId: number) {
  const pr = await getTaskOpenPullRequest(workspace.id, taskId);
  if (!pr) return null;
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return null;
  try {
    return (await refreshPullRequest(workspace, pr, token)) ? pr : null;
  } catch (error) {
    console.warn(`[pull-requests] rerun check of #${pr.number} failed`, error);
    return null;
  }
}

export type PullRequestView = {
  id: number;
  number: number;
  url: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  state: "open" | "merged" | "closed";
  reviewStatus: "pending" | "approved" | "changes_requested";
  testStatus: "pending" | "passed" | "failed";
  mergeError: string | null;
  /** Merge is offered once review and tests passed. */
  canMerge: boolean;
  task: { key: string; title: string } | null;
  runStatus: RunStatus | null;
  createdAt: string;
  mergedAt: string | null;
};

export async function listPullRequests(workspace: Pick<Workspace, "id" | "name">): Promise<PullRequestView[]> {
  const rows = await db
    .select({ pr: pullRequests, taskNumber: tasks.number, taskTitle: tasks.title, runStatus: agentRuns.status })
    .from(pullRequests)
    .leftJoin(tasks, eq(tasks.id, pullRequests.taskId))
    .leftJoin(agentRuns, eq(agentRuns.id, pullRequests.runId))
    .where(eq(pullRequests.workspaceId, workspace.id))
    .orderBy(desc(pullRequests.createdAt))
    .limit(100);
  const prefix = taskKeyPrefix(workspace.name);
  return rows.map(({ pr, taskNumber, taskTitle, runStatus }) => ({
    id: pr.id,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    state: pr.state as PullRequestView["state"],
    reviewStatus: pr.reviewStatus as PullRequestView["reviewStatus"],
    testStatus: pr.testStatus as PullRequestView["testStatus"],
    mergeError: pr.mergeError,
    canMerge: pr.state === "open" && pr.reviewStatus === "approved" && pr.testStatus === "passed",
    task: taskNumber !== null && taskTitle !== null ? { key: `${prefix}-${taskNumber}`, title: taskTitle } : null,
    runStatus: (runStatus as RunStatus | null) ?? null,
    createdAt: pr.createdAt.toISOString(),
    mergedAt: pr.mergedAt?.toISOString() ?? null,
  }));
}

