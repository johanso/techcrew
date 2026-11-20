import "server-only";

import { eq } from "drizzle-orm";

import { agentRuns, db } from "@/db";
import type { PermissionId } from "@/lib/agent-config";
import { conflictMarkerLines, mergeText } from "@/lib/diff3";
import {
  GithubError,
  commitTree,
  createBlob,
  getBlob,
  getBranchSha,
  getCommit,
  getMergeBase,
  getTreeEntries,
  mergeIntoBranch,
} from "@/lib/github";
import {
  MERGE_CONFLICTS_MAX,
  MERGE_FILE_MAX_BYTES,
  MERGE_PATHS_MAX,
  isBinaryContent,
  mergeCommitMessage,
  mergeLabels,
  mergedMode,
  mergedReport,
  parsePendingMerge,
  parseResolveArgs,
  pendingReport,
  planMerge,
  routeConflict,
  unresolvedConflicts,
  type MergeEntry,
  type PendingConflict,
  type PendingMerge,
  type TreeEntry,
} from "@/lib/merge-config";
import { cleanRepoPath, pathWriteRefusal } from "@/lib/repo-paths";

/**
 * The Developer's merge tools (lib/agent-tools.ts): merge_default_branch brings the default branch into the run's
 * branch as a real merge commit (two parents), so GitHub sees the pull request as mergeable again.
 *
 * GitHub's merge API goes first: without conflicts it makes the merge commit itself. With conflicts the app plans the
 * merge from the three trees (merge base, branch, default branch), merges what it can line by line (lib/diff3.ts),
 * and keeps the rest in agent_runs.pending_merge for the agent: read_conflict shows a file with conflict markers,
 * resolve_conflict stores the resolved file as a blob, and finish_merge commits the merged tree on top of the default
 * branch's tree with parents [branch head, default head], fast-forward only. Nothing is cloned and no token enters a
 * container; the database keeps shas, never file contents.
 */

export type MergeContext = {
  token: string;
  repo: string;
  defaultBranch: string;
  branch: string | null;
  runId: number;
  permissions: PermissionId[];
  /** add_dependency is offered too: the lockfile note says to re-add packages with it. */
  canAddDependency: boolean;
};

const READ_LINES_MAX = 500;
const OUTPUT_MAX = 24_000;

async function loadPending(runId: number) {
  const [row] = await db.select({ pending: agentRuns.pendingMerge }).from(agentRuns).where(eq(agentRuns.id, runId));
  return parsePendingMerge(row?.pending ?? null);
}

async function savePending(runId: number, pending: PendingMerge | null) {
  await db.update(agentRuns).set({ pendingMerge: pending, updatedAt: new Date() }).where(eq(agentRuns.id, runId));
}

/** Drops a merge left open (a development stage starts fresh). */
export function clearPendingMerge(runId: number) {
  return savePending(runId, null);
}

/** Why a write to the branch is refused right now: a merge is open (a commit would move the branch under it). */
export async function mergeWriteBlock(runId: number) {
  return (await loadPending(runId))
    ? 'Error: a merge is in progress. Resolve its conflicts and call finish_merge with outcome "commit" (or "abort") before changing the branch.'
    : null;
}

/** GitHub refuses commits that change workflow files to OAuth tokens without the workflow scope, merges included. */
function workflowRefusal(error: unknown, defaultBranch: string) {
  if (!(error instanceof GithubError) || !/workflow/i.test(error.message)) return null;
  return `Error: GitHub refused the merge: ${defaultBranch} changed a workflow file (.github/workflows) and TechTeam's GitHub connection may not write those. Nothing was changed. Say so in your summary: the owner updates the branch on GitHub ("Update branch" on the pull request).`;
}

const refusal = (ctx: MergeContext, reasons: string[]) =>
  `Error: ${ctx.defaultBranch} can't be merged into ${ctx.branch} by an agent: ${reasons.join("; ")}. Nothing was changed. Say so in your summary: the owner resolves it on GitHub (the pull request's "Resolve conflicts") or locally.`;

const textOf = (bytes: Buffer) => bytes.toString("utf8");

/** A conflicted side's file, unless it's binary or too large to merge as text. */
async function readSide(ctx: MergeContext, entry: TreeEntry | null): Promise<{ ok: true; text: string } | { ok: false; reason: "binary" | "large" }> {
  if (!entry) return { ok: true, text: "" };
  if ((entry.size ?? 0) > MERGE_FILE_MAX_BYTES) return { ok: false, reason: "large" };
  const bytes = await getBlob(ctx.token, ctx.repo, entry.sha);
  if (bytes.length > MERGE_FILE_MAX_BYTES) return { ok: false, reason: "large" };
  if (isBinaryContent(bytes)) return { ok: false, reason: "binary" };
  return { ok: true, text: textOf(bytes) };
}

async function sideTexts(ctx: MergeContext, conflict: Pick<PendingConflict, "base" | "ours" | "theirs">) {
  const [base, ours, theirs] = await Promise.all([readSide(ctx, conflict.base), readSide(ctx, conflict.ours), readSide(ctx, conflict.theirs)]);
  if (!base.ok || !ours.ok || !theirs.ok) return null;
  return { base: base.text, ours: ours.text, theirs: theirs.text };
}

/** Commits the merge: the default branch's tree plus `entries`, parents [ours, theirs]; moves the branch forward. */
async function commitMerge(ctx: MergeContext & { branch: string }, input: { ours: string; theirs: string; theirsTree: string; entries: MergeEntry[] }) {
  return commitTree(ctx.token, ctx.repo, {
    branch: ctx.branch,
    baseTreeSha: input.theirsTree,
    entries: input.entries,
    parents: [input.ours, input.theirs],
    message: mergeCommitMessage(ctx.defaultBranch, ctx.branch),
  });
}

/** The resolved conflicts as tree entries. A deletion the default branch's tree doesn't have needs no entry. */
const resolutionEntries = (pending: PendingMerge): MergeEntry[] =>
  pending.conflicts.flatMap((c) =>
    c.resolution && (c.resolution.sha !== null || c.theirs) ? [{ path: c.path, mode: c.resolution.mode, type: "blob" as const, sha: c.resolution.sha }] : []
  );

/** merge_default_branch. */
export async function mergeDefaultBranch(ctx: MergeContext): Promise<string> {
  const branch = ctx.branch;
  if (!branch) return "Error: there is no working branch yet.";
  const [ours, theirs] = await Promise.all([getBranchSha(ctx.token, ctx.repo, branch), getBranchSha(ctx.token, ctx.repo, ctx.defaultBranch)]);
  if (!ours) return `Error: branch ${branch} not found.`;
  if (!theirs) return `Error: the default branch ${ctx.defaultBranch} wasn't found.`;

  const stored = await loadPending(ctx.runId);
  if (stored) {
    if (stored.branch === branch && stored.ours === ours && stored.theirs === theirs) {
      return pendingReport(stored, { resumed: true, canAddDependency: ctx.canAddDependency });
    }
    // A branch moved since: that merge is stale.
    await savePending(ctx.runId, null);
  }

  let attempt: Awaited<ReturnType<typeof mergeIntoBranch>>;
  try {
    attempt = await mergeIntoBranch(ctx.token, ctx.repo, { base: branch, head: theirs, message: mergeCommitMessage(ctx.defaultBranch, branch) });
  } catch (error) {
    const refused = workflowRefusal(error, ctx.defaultBranch);
    if (refused) return refused;
    throw error;
  }
  if (attempt.status === "up_to_date") return `${branch} already has every commit of ${ctx.defaultBranch} (${theirs.slice(0, 7)}): nothing to merge.`;
  if (attempt.status === "merged") {
    return mergedReport({ branch, defaultBranch: ctx.defaultBranch, theirs, commit: attempt.sha, resolved: [], autoMerged: [], lockfiles: [], canAddDependency: ctx.canAddDependency });
  }
  return planConflictedMerge({ ...ctx, branch }, ours, theirs);
}

/** GitHub found conflicts: plan the merge from the three trees, merge what merges cleanly, keep the rest for the agent. */
async function planConflictedMerge(ctx: MergeContext & { branch: string }, ours: string, theirs: string): Promise<string> {
  const base = await getMergeBase(ctx.token, ctx.repo, theirs, ours);
  if (!base) return refusal(ctx, ["the two branches share no history"]);
  const commits = await Promise.all([base, ours, theirs].map((sha) => getCommit(ctx.token, ctx.repo, sha)));
  const trees = await Promise.all(commits.map((commit) => getTreeEntries(ctx.token, ctx.repo, commit.treeSha)));
  if (trees.some((tree) => tree.truncated)) return refusal(ctx, ["the repository is too large to list in one request"]);
  const plan = planMerge({ base: trees[0]!.entries, ours: trees[1]!.entries, theirs: trees[2]!.entries });

  const reasons: string[] = [];
  const lockfiles: string[] = [];
  const forAgent: (typeof plan.conflicts[number] & { kind: PendingConflict["kind"] })[] = [];
  for (const conflict of plan.conflicts) {
    const route = routeConflict(conflict, ctx.permissions);
    if (route.route === "refused") reasons.push(route.reason);
    else if (route.route === "lockfile") lockfiles.push(conflict.path);
    else forAgent.push({ ...conflict, kind: route.kind });
  }
  if (plan.take.length > MERGE_PATHS_MAX) reasons.push(`the branch changed more than ${MERGE_PATHS_MAX} files`);
  if (forAgent.length > MERGE_CONFLICTS_MAX) reasons.push(`${forAgent.length} files conflict (an agent resolves up to ${MERGE_CONFLICTS_MAX})`);
  if (reasons.length) return refusal(ctx, reasons);

  const take = [...plan.take];
  const autoMerged: string[] = [];
  const conflicts: PendingConflict[] = [];
  const labels = mergeLabels({ branch: ctx.branch, defaultBranch: ctx.defaultBranch });
  for (const conflict of forAgent) {
    const texts = await sideTexts(ctx, conflict);
    if (!texts) {
      reasons.push(`${conflict.path} is binary or larger than ${MERGE_FILE_MAX_BYTES / 1000} KB`);
      continue;
    }
    const entry = { path: conflict.path, kind: conflict.kind, base: conflict.base, ours: conflict.ours, theirs: conflict.theirs, resolution: null };
    if (conflict.kind === "delete") {
      conflicts.push(entry);
      continue;
    }
    const merged = mergeText(texts.base, texts.ours, texts.theirs, labels);
    if (merged.conflicts > 0) {
      conflicts.push(entry);
      continue;
    }
    // GitHub's merge stopped on this file, but the changes don't overlap line by line here: no question to ask.
    take.push({ path: conflict.path, mode: mergedMode(conflict), type: "blob", sha: await createBlob(ctx.token, ctx.repo, merged.text) });
    autoMerged.push(conflict.path);
  }
  if (reasons.length) return refusal(ctx, reasons);

  const theirsTree = commits[2]!.treeSha;
  if (!conflicts.length) {
    // Everything merged on its own (lockfiles taken from the default branch): commit right away.
    const commit = await commitOrExplain(ctx, { ours, theirs, theirsTree, entries: take });
    if (!commit.ok) return commit.error;
    return mergedReport({ branch: ctx.branch, defaultBranch: ctx.defaultBranch, theirs, commit: commit.sha, resolved: [], autoMerged, lockfiles, canAddDependency: ctx.canAddDependency });
  }
  const pending: PendingMerge = {
    branch: ctx.branch,
    defaultBranch: ctx.defaultBranch,
    ours,
    theirs,
    base,
    theirsTree,
    take,
    autoMerged,
    lockfiles,
    conflicts,
    startedAt: new Date().toISOString(),
  };
  await savePending(ctx.runId, pending);
  return pendingReport(pending, { resumed: false, canAddDependency: ctx.canAddDependency });
}

/** commitMerge, with GitHub's refusals as answers for the agent. */
async function commitOrExplain(
  ctx: MergeContext & { branch: string },
  input: Parameters<typeof commitMerge>[1]
): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  try {
    return { ok: true, sha: await commitMerge(ctx, input) };
  } catch (error) {
    const refused = workflowRefusal(error, ctx.defaultBranch);
    if (refused) return { ok: false, error: refused };
    if (error instanceof GithubError && error.status === 422) {
      // The ref only fast-forwards: a commit landed on the branch meanwhile. Otherwise GitHub refused the tree itself
      // (e.g. a file on one side where the other has a folder).
      const head = await getBranchSha(ctx.token, ctx.repo, ctx.branch);
      if (head !== input.ours) return { ok: false, error: `Error: ${ctx.branch} moved while the merge was being committed. Call merge_default_branch again.` };
      return { ok: false, error: `Error: GitHub refused the merged tree (${error.message}). Nothing was committed. Say so in your summary: the owner merges this one by hand.` };
    }
    throw error;
  }
}

async function requirePending(ctx: MergeContext, rawPath: unknown) {
  const pending = await loadPending(ctx.runId);
  if (!pending) return { ok: false, error: "Error: no merge is in progress. Call merge_default_branch first." } as const;
  const path = cleanRepoPath(rawPath);
  const conflict = path ? pending.conflicts.find((c) => c.path === path) : undefined;
  if (!conflict) return { ok: false, error: `Error: ${String(rawPath)} isn't one of the merge's conflicts: ${pending.conflicts.map((c) => c.path).join(", ")}.` } as const;
  return { ok: true, pending, conflict } as const;
}

const lineArg = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

/** read_conflict: the file with conflict markers (or, for a deletion, the surviving version), with line numbers. */
export async function readConflict(ctx: MergeContext, args: Record<string, unknown>): Promise<string> {
  const found = await requirePending(ctx, args.path);
  if (!found.ok) return found.error;
  const { pending, conflict } = found;
  const texts = await sideTexts(ctx, conflict);
  if (!texts) return `Error: ${conflict.path} can't be read as text.`;

  let header: string;
  let text: string;
  if (conflict.kind === "delete") {
    const kept = conflict.ours ? "your branch" : pending.defaultBranch;
    const deleted = conflict.ours ? pending.defaultBranch : "your branch";
    text = conflict.ours ? texts.ours : texts.theirs;
    header = `${conflict.path}: ${deleted} deleted it, ${kept} changed it. ${kept}'s version follows. resolve_conflict with content null keeps it deleted; with the whole file, keeps that.`;
  } else {
    const merged = mergeText(texts.base, texts.ours, texts.theirs, mergeLabels(pending));
    text = merged.text;
    header = `${conflict.path}: ${merged.conflicts} conflicting section${merged.conflicts === 1 ? "" : "s"}, each "<<<<<<< ${mergeLabels(pending).ours}" (your lines), "||||||| merge base" (the lines before either change), "=======", then ${pending.defaultBranch}'s lines and ">>>>>>> …". Lines outside the markers are merged already.`;
  }
  if (conflict.resolution) header += " You resolved it already; resolve_conflict again replaces your resolution.";

  const lines = text.split("\n");
  const start = Math.max(1, lineArg(args.start_line) ?? 1);
  const end = Math.min(lines.length, lineArg(args.end_line) ?? start + READ_LINES_MAX - 1, start + READ_LINES_MAX - 1);
  const body = lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join("\n");
  const page = `${header}\n(lines ${start}-${end} of ${lines.length})\n${body}`;
  return page.length > OUTPUT_MAX ? `${page.slice(0, OUTPUT_MAX)}\n… [truncated: read fewer lines at a time]` : page;
}

/** resolve_conflict: checks the resolved file and stores it as a blob for finish_merge. */
export async function resolveConflict(ctx: MergeContext, args: Record<string, unknown>): Promise<string> {
  const parsed = parseResolveArgs(args);
  if (!parsed.ok) return `Error: ${parsed.error}`;
  const found = await requirePending(ctx, parsed.path);
  if (!found.ok) return found.error;
  const { pending, conflict } = found;
  const refused = pathWriteRefusal(conflict.path, ctx.permissions);
  if (refused) return refused;

  let note = "";
  if (parsed.content === null) {
    if (conflict.kind !== "delete") return `Error: both sides changed ${conflict.path}; give the whole merged file (deleting it would drop both changes).`;
  } else {
    const texts = await sideTexts(ctx, conflict);
    // Allowed (sometimes right), but usually a side's changes dropped by mistake: say so.
    if (texts && conflict.kind === "content" && parsed.content === texts.ours) {
      note = `\nNote: this is exactly your branch's version, so ${pending.defaultBranch}'s changes to ${conflict.path} are dropped. If that isn't intended, resolve it again.`;
    } else if (texts && conflict.kind === "content" && parsed.content === texts.theirs) {
      note = `\nNote: this is exactly ${pending.defaultBranch}'s version, so your branch's changes to ${conflict.path} are dropped. If that isn't intended, resolve it again.`;
    }
    const markers = conflictMarkerLines(parsed.content, texts ? [texts.ours, texts.theirs] : []);
    if (markers.length) {
      const shown = markers.slice(0, 10).join(", ");
      return `Error: ${conflict.path} still has conflict markers on line${markers.length === 1 ? "" : "s"} ${shown}${markers.length > 10 ? " …" : ""}. Resolve every section: keep the right lines from each side and remove the marker lines.`;
    }
  }
  const sha = parsed.content === null ? null : await createBlob(ctx.token, ctx.repo, parsed.content);
  const next: PendingMerge = {
    ...pending,
    conflicts: pending.conflicts.map((c) => (c.path === conflict.path ? { ...c, resolution: { sha, mode: mergedMode(c) } } : c)),
  };
  await savePending(ctx.runId, next);
  const left = unresolvedConflicts(next).length;
  return `Resolved ${conflict.path}${sha === null ? " (deleted)" : ""}: ${left ? `${left} conflict${left === 1 ? "" : "s"} left` : 'every conflict is resolved, so call finish_merge with outcome "commit"'}.${note}`;
}

/** finish_merge: commits the merge with the resolutions (outcome "commit"), or drops it ("abort"). */
export async function finishMerge(ctx: MergeContext, args: Record<string, unknown>): Promise<string> {
  const outcome = args.outcome;
  if (outcome !== "commit" && outcome !== "abort") return 'Error: outcome must be "commit" or "abort".';
  const pending = await loadPending(ctx.runId);
  if (!pending) return "Error: no merge is in progress. Call merge_default_branch first.";
  if (outcome === "abort") {
    await savePending(ctx.runId, null);
    return `Aborted the merge of ${pending.defaultBranch} into ${pending.branch}; nothing was committed. Say in your summary why it couldn't be merged.`;
  }
  const open = unresolvedConflicts(pending);
  if (open.length) return `Error: ${open.length} conflict${open.length === 1 ? "" : "s"} still unresolved: ${open.map((c) => c.path).join(", ")}.`;
  if (!ctx.branch || ctx.branch !== pending.branch) return "Error: the merge belongs to another branch.";
  const branch = ctx.branch;

  const [ours, theirs] = await Promise.all([getBranchSha(ctx.token, ctx.repo, branch), getBranchSha(ctx.token, ctx.repo, pending.defaultBranch)]);
  const summary = {
    branch,
    defaultBranch: pending.defaultBranch,
    theirs: pending.theirs,
    resolved: pending.conflicts.map((c) => c.path),
    autoMerged: pending.autoMerged,
    lockfiles: pending.lockfiles,
    canAddDependency: ctx.canAddDependency,
  };
  if (ours !== pending.ours) {
    // A retried step whose commit went through already: the branch's head is this merge.
    if (ours) {
      const head = await getCommit(ctx.token, ctx.repo, ours);
      if (head.parents.length === 2 && head.parents[0] === pending.ours && head.parents[1] === pending.theirs) {
        await savePending(ctx.runId, null);
        return mergedReport({ ...summary, commit: ours });
      }
    }
    await savePending(ctx.runId, null);
    return `Error: ${branch} moved since the merge started, so the merge was dropped. Call merge_default_branch again.`;
  }
  if (theirs !== pending.theirs) {
    await savePending(ctx.runId, null);
    return `Error: ${pending.defaultBranch} got new commits since the merge started, so the merge was dropped. Call merge_default_branch again to merge the latest.`;
  }

  const commit = await commitOrExplain(
    { ...ctx, branch },
    { ours: pending.ours, theirs: pending.theirs, theirsTree: pending.theirsTree, entries: [...pending.take, ...resolutionEntries(pending)] }
  );
  await savePending(ctx.runId, null);
  if (!commit.ok) return commit.error;
  return mergedReport({ ...summary, commit: commit.sha });
}
