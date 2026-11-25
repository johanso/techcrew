import "server-only";

import { and, desc, eq, or } from "drizzle-orm";

import { agentRuns, db, pullRequests, tasks, workspaces, type PullRequestRow, type Workspace } from "@/db";
import { RISK_LEVELS, isActiveRun, type RiskLevel, type RunStatus } from "@/lib/agent-run-config";
import { createRun, finishRun, placeTask, replaceWaitingRuns, runningPreviewUrl } from "@/lib/agent-runs";
import { getAgentRow, logAgentActivity, taskKeyPrefix } from "@/lib/agents";
import { createAgentTask } from "@/lib/board";
import { GithubError, createIssue, getCommitChecks, getGithubToken, getPullRequest, mergePullRequest } from "@/lib/github";
import { collectsSignals } from "@/lib/memory-signals";
import { askWhyRejected } from "@/lib/memory-signals-store";
import { pickContinuedPullRequest } from "@/lib/merge-config";
import { notify } from "@/lib/notifications";
import { stopPullRequestPreviews } from "@/lib/sandbox/preview";

/**
 * Agent pull requests: merging (automatically after review + tests, or from the Pull Requests page), the tester's
 * follow-up card when a merge is blocked by a conflict or a failing build, carrying a pull request over to the next
 * run (a rerun of its card, or the run of its follow-up card) and keeping state in step with GitHub.
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
  if (!token) return { status: "error", reason: "Reconnect GitHub to merge." };
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
  await stopPullRequestPreviews(workspace.id, pr.number, "The pull request was merged.");
  if (pr.taskId) await placeTask(workspace.id, pr.taskId, "done", null);
  // The Tester's follow-up card (conflict or failing build) was about this merge: it's done too.
  if (pr.followUpTaskId && pr.followUpTaskId !== pr.taskId) await placeTask(workspace.id, pr.followUpTaskId, "done", null);
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

/**
 * A pull request closed on GitHub without merging (TechTeam never closes one itself): its run ends, and the owner is
 * asked why once, unless another pull request already took its place (askWhyRejected).
 */
async function closeWithoutMerge(pr: PullRequestRow) {
  await db.update(pullRequests).set({ state: "closed", updatedAt: new Date() }).where(eq(pullRequests.id, pr.id));
  await askWhyRejected(pr.id);
  await stopPullRequestPreviews(pr.workspaceId, pr.number, "The pull request was closed.");
  if (pr.runId) {
    const [run] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, pr.runId));
    if (run && (run.status === "awaiting_merge" || isActiveRun(run.status as RunStatus))) {
      await finishRun(pr.runId, "failed", "The pull request was closed on GitHub without merging.");
    }
  }
}

/**
 * The merge can't happen: the tester files a follow-up card in Todo (a GitHub issue too, with the
 * "File issues" permission) so the problem gets picked up like any other task. One follow-up per pull request.
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
      `Running this card continues on \`${pr.headBranch}\` and PR #${pr.number}: the Developer brings \`${pr.baseBranch}\` into the branch and resolves the conflicts (or fixes the build), and the pull request is reviewed and tested again. When it merges, ${originKey ?? "the original card"} and this card are done.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const tester = await getAgentRow(workspace.id, "tester");
    let github: Parameters<typeof createAgentTask>[1]["github"] = null;
    if (tester?.permissions.includes("issues.create")) {
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
    body: `${reason}${followUpKey ? ` The Tester filed ${followUpKey}: run it and the agents fix this pull request.` : ""}`,
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
 * A new run takes over an open pull request: it works on the same branch and PR, whose review and test verdicts start
 * over. (openPullRequest then finds it by run id and reuses it, as in a rework round.) The last merge error stays
 * until then: the new run's brief says why the merge failed.
 */
export async function adoptPullRequest(pullRequestId: number, runId: number) {
  await db
    .update(pullRequests)
    .set({ runId, reviewStatus: "pending", testStatus: "pending", risk: null, updatedAt: new Date() })
    .where(eq(pullRequests.id, pullRequestId));
}

/**
 * The open pull request a board card works on (Merge on the card, reruns): its own newest one, else the one it is the
 * follow-up card of (pickContinuedPullRequest).
 */
export async function getTaskOpenPullRequest(workspaceId: number, taskId: number) {
  if (!Number.isSafeInteger(taskId)) return null;
  const rows = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, workspaceId),
        eq(pullRequests.state, "open"),
        or(eq(pullRequests.taskId, taskId), eq(pullRequests.followUpTaskId, taskId))
      )
    );
  return pickContinuedPullRequest(taskId, rows)?.pr ?? null;
}

/**
 * Creates a run on a card (Run on the board, auto pickup). When the card has an open pull request, or is the
 * follow-up card of one, the run continues on its branch and PR (getRerunPullRequest, adoptPullRequest) and earlier
 * runs waiting on that PR end as replaced. Refused while another card's run works on the same PR.
 */
export async function createCardRun(
  workspace: PrWorkspace,
  input: { taskId: number; trigger: "manual" | "auto"; createdById?: number | null }
): Promise<{ ok: true; runId: number; pullRequest: number | null } | { ok: false; error: string }> {
  const openPr = await getRerunPullRequest(workspace, input.taskId);
  if (openPr?.runId) {
    const [current] = await db.select({ status: agentRuns.status, taskId: agentRuns.taskId }).from(agentRuns).where(eq(agentRuns.id, openPr.runId));
    if (current && isActiveRun(current.status as RunStatus)) {
      const [card] = await db.select({ number: tasks.number }).from(tasks).where(eq(tasks.id, current.taskId));
      const key = card ? `${taskKeyPrefix(workspace.name)}-${card.number}` : "another card";
      return { ok: false, error: `The agents are already working on PR #${openPr.number} (${key}). Wait for that run, or stop it first.` };
    }
  }
  const run = await createRun({ workspaceId: workspace.id, ...input, branch: openPr?.headBranch ?? null });
  // Another run started on this card meanwhile, maybe on the owner's other computer.
  if (!run) return { ok: false, error: "The agents are already working on this card. Wait for that run, or stop it first." };
  if (openPr) {
    await adoptPullRequest(openPr.id, run.id);
    await replaceWaitingRuns([...new Set([input.taskId, openPr.taskId ?? input.taskId])], run.id);
  }
  return { ok: true, runId: run.id, pullRequest: openPr?.number ?? null };
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
      return { ok: false, error: `${outcome.reason}${outcome.followUpKey ? ` The Tester filed ${outcome.followUpKey} in Todo: run it and the agents fix this pull request.` : ""}` };
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
 * The open pull request a run of the card continues on (its own, or the one it is the follow-up card of) — checked on
 * GitHub first, since it may have been closed or merged there (that change is applied, and null returned, so the run
 * starts a fresh branch).
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
  /** The Lead's decision. */
  reviewStatus: "pending" | "approved" | "changes_requested";
  /** The Lead's final risk rating; null until approval. */
  risk: RiskLevel | null;
  testStatus: "pending" | "passed" | "failed";
  mergeError: string | null;
  /** Merge is offered once the Lead approved and tests passed. */
  canMerge: boolean;
  /** Closed without merging and the owner hasn't said why (or dismissed the question). Never while memory is off. */
  askWhyRejected: boolean;
  task: { key: string; title: string } | null;
  runStatus: RunStatus | null;
  /** The public URL of the run's preview while it's running, else null. */
  previewUrl: string | null;
  createdAt: string;
  mergedAt: string | null;
};

export async function listPullRequests(workspace: Pick<Workspace, "id" | "name" | "memoryMode">): Promise<PullRequestView[]> {
  const rows = await db
    .select({ pr: pullRequests, taskNumber: tasks.number, taskTitle: tasks.title, runStatus: agentRuns.status, preview: agentRuns.preview })
    .from(pullRequests)
    .leftJoin(tasks, eq(tasks.id, pullRequests.taskId))
    .leftJoin(agentRuns, eq(agentRuns.id, pullRequests.runId))
    .where(eq(pullRequests.workspaceId, workspace.id))
    .orderBy(desc(pullRequests.createdAt))
    .limit(100);
  const prefix = taskKeyPrefix(workspace.name);
  return rows.map(({ pr, taskNumber, taskTitle, runStatus, preview }) => ({
    id: pr.id,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    state: pr.state as PullRequestView["state"],
    reviewStatus: pr.reviewStatus as PullRequestView["reviewStatus"],
    risk: (RISK_LEVELS as readonly string[]).includes(pr.risk ?? "") ? (pr.risk as RiskLevel) : null,
    testStatus: pr.testStatus as PullRequestView["testStatus"],
    mergeError: pr.mergeError,
    canMerge: pr.state === "open" && pr.reviewStatus === "approved" && pr.testStatus === "passed",
    askWhyRejected: collectsSignals(workspace.memoryMode) && pr.state === "closed" && pr.mergedAt === null && pr.rejectionPrompt === "pending",
    task: taskNumber !== null && taskTitle !== null ? { key: `${prefix}-${taskNumber}`, title: taskTitle } : null,
    runStatus: (runStatus as RunStatus | null) ?? null,
    previewUrl: pr.state === "open" ? runningPreviewUrl(preview) : null,
    createdAt: pr.createdAt.toISOString(),
    mergedAt: pr.mergedAt?.toISOString() ?? null,
  }));
}

