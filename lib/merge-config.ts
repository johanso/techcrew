import type { PermissionId } from "@/lib/agent-config";
import { isLockfile, isManifestPath, isProtectedPath } from "@/lib/repo-paths";

/**
 * Bringing the default branch into a pull request's branch (merge_default_branch, lib/branch-merge.ts) and carrying
 * a pull request over to the run that fixes it. Pure and tested: the tree plan, which conflicts an agent may resolve,
 * the merge kept between tool calls (agent_runs.pending_merge), the tools' answers and the briefs.
 */

/** A blob or submodule in a commit's tree (git trees API, recursive; directories left out). */
export type TreeEntry = { mode: string; type: "blob" | "commit"; sha: string; size?: number };
export type TreeMap = Record<string, TreeEntry>;

/** One path of the merged tree, on top of the default branch's tree. `sha` null deletes the path. */
export type MergeEntry = { path: string; mode: string; type: "blob" | "commit"; sha: string | null };

/** A path both sides changed differently since the merge base (absent side: deleted, or never there). */
export type PlannedConflict = { path: string; base: TreeEntry | null; ours: TreeEntry | null; theirs: TreeEntry | null };

const same = (a: TreeEntry | undefined, b: TreeEntry | undefined) => (!a && !b) || (a !== undefined && b !== undefined && a.sha === b.sha && a.mode === b.mode);

/**
 * The merged tree as changes to the default branch's tree (`theirs`): every path only your branch (`ours`) changed
 * since the merge base, plus the paths both changed differently, to resolve. Paths only the default branch changed,
 * or both changed the same way, are already right in its tree.
 */
export function planMerge(trees: { base: TreeMap; ours: TreeMap; theirs: TreeMap }): { take: MergeEntry[]; conflicts: PlannedConflict[] } {
  const { base, ours, theirs } = trees;
  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  const take: MergeEntry[] = [];
  const conflicts: PlannedConflict[] = [];
  for (const path of paths) {
    const b = base[path];
    const o = ours[path];
    const t = theirs[path];
    if (same(o, b) || same(o, t)) continue;
    if (same(t, b)) {
      take.push(o ? { path, mode: o.mode, type: o.type, sha: o.sha } : { path, mode: b!.mode, type: b!.type, sha: null });
      continue;
    }
    conflicts.push({ path, base: b ?? null, ours: o ?? null, theirs: t ?? null });
  }
  return { take, conflicts };
}

/** The mode a merged file keeps: a mode change on one side wins over the base's (e.g. made executable). */
export function mergedMode(conflict: Pick<PlannedConflict, "base" | "ours" | "theirs">) {
  const { base, ours, theirs } = conflict;
  if (ours && (!base || ours.mode !== base.mode)) return ours.mode;
  return theirs?.mode ?? ours?.mode ?? base?.mode ?? "100644";
}

const REGULAR_MODES = new Set(["100644", "100755"]);

/**
 * What happens to one conflict before any file is read: `lockfile` takes the default branch's version (lockfiles are
 * regenerated, never merged by hand), `agent` goes to the agent (after an automatic text merge for `content`), and
 * `refused` stops the whole merge with a reason for the owner.
 */
export type ConflictRoute =
  | { route: "lockfile" }
  | { route: "agent"; kind: "content" | "delete" }
  | { route: "refused"; reason: string };

export function routeConflict(conflict: PlannedConflict, permissions: readonly PermissionId[]): ConflictRoute {
  const { path, ours, theirs } = conflict;
  if (isProtectedPath(path)) return { route: "refused", reason: `${path} is protected (CI workflows, env files and git internals), so agents can't merge it` };
  const sides = [ours, theirs].filter((side): side is TreeEntry => side !== null);
  if (sides.some((side) => side.type !== "blob" || !REGULAR_MODES.has(side.mode))) {
    return { route: "refused", reason: `${path} is a submodule or a symbolic link, which agents can't merge` };
  }
  if (isLockfile(path)) return { route: "lockfile" };
  if (isManifestPath(path) && !permissions.includes("deps.manage")) {
    return { route: "refused", reason: `${path} is a dependency manifest and the Developer doesn't have the "Manage dependencies" permission` };
  }
  return { route: "agent", kind: ours && theirs ? "content" : "delete" };
}

/** Above these, merge_default_branch refuses and the owner merges by hand. */
export const MERGE_CONFLICTS_MAX = 20;
export const MERGE_PATHS_MAX = 3000;
/** A conflicted file's size limit (each side), the same as one write_file. */
export const MERGE_FILE_MAX_BYTES = 200_000;

/** Git's heuristic for binary content: a NUL byte in the first 8000 bytes. Invalid UTF-8 counts too (it can't be edited as text). */
export function isBinaryContent(bytes: Uint8Array) {
  if (bytes.subarray(0, 8000).includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

// ── The merge kept between tool calls ─────────────────────────────────────────

export type PendingConflict = {
  path: string;
  /** content: both sides changed it; delete: one side deleted it, the other changed it. */
  kind: "content" | "delete";
  base: TreeEntry | null;
  ours: TreeEntry | null;
  theirs: TreeEntry | null;
  /** The agent's resolution: a blob it wrote (sha) or the file deleted (sha null). Null until resolved. */
  resolution: { sha: string | null; mode: string } | null;
};

/**
 * A merge waiting for the agent's resolutions (agent_runs.pending_merge). Shas only, never file contents: resolved
 * files are blobs in the repository until finish_merge commits them.
 */
export type PendingMerge = {
  branch: string;
  defaultBranch: string;
  /** The branch's head, the default branch's head and their merge base when the merge started. */
  ours: string;
  theirs: string;
  base: string;
  /** The default branch head's tree: the merged tree is built on it. */
  theirsTree: string;
  /** Paths only your branch changed, plus files merged automatically. */
  take: MergeEntry[];
  /** Files merged automatically (their entries are in `take`). */
  autoMerged: string[];
  /** Lockfiles that took the default branch's version. */
  lockfiles: string[];
  conflicts: PendingConflict[];
  startedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored merge, or null when there is none (or it isn't one: the column is jsonb). */
export function parsePendingMerge(value: unknown): PendingMerge | null {
  if (!isRecord(value)) return null;
  const strings = ["branch", "defaultBranch", "ours", "theirs", "base", "theirsTree", "startedAt"] as const;
  if (strings.some((key) => typeof value[key] !== "string")) return null;
  if (![value.take, value.autoMerged, value.lockfiles, value.conflicts].every(Array.isArray)) return null;
  return value as PendingMerge;
}

export const unresolvedConflicts = (pending: PendingMerge) => pending.conflicts.filter((c) => c.resolution === null);

/** The commit message of the merge commit, as git writes it. */
export const mergeCommitMessage = (defaultBranch: string, branch: string) => `Merge branch '${defaultBranch}' into ${branch}`;

/** Conflict markers' labels: which side is which, in the agent's terms. */
export const mergeLabels = (pending: Pick<PendingMerge, "branch" | "defaultBranch">) => ({
  ours: `${pending.branch} (your branch)`,
  base: "merge base",
  theirs: `${pending.defaultBranch} (default branch)`,
});

// ── Tool answers (the first line is all the agent log keeps) ──────────────────

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const conflictLine = (c: PendingConflict, pending: PendingMerge) => {
  const what =
    c.kind === "content"
      ? c.base
        ? "both changed it"
        : "both added it"
      : c.ours
        ? `${pending.defaultBranch} deleted it, your branch changed it`
        : `your branch deleted it, ${pending.defaultBranch} changed it`;
  return `- ${c.path}: ${what}${c.resolution ? " (resolved)" : ""}`;
};

function lockfileNote(lockfiles: readonly string[], defaultBranch: string, canAddDependency: boolean) {
  if (!lockfiles.length) return "";
  return `\n${lockfiles.join(", ")} conflicted: took ${defaultBranch}'s version (lockfiles are regenerated, never merged by hand). ${
    canAddDependency
      ? "If your branch added or changed packages, call add_dependency for each after the merge so the lockfile pins them again."
      : "If your branch added or changed packages, the lockfile no longer pins them: say so in your summary."
  }`;
}

/** merge_default_branch stopped with conflicts to resolve, or reports the merge already in progress. */
export function pendingReport(pending: PendingMerge, input: { resumed: boolean; canAddDependency: boolean }) {
  const open = unresolvedConflicts(pending);
  const first = input.resumed
    ? `A merge of ${pending.defaultBranch} into ${pending.branch} is in progress: ${plural(open.length, "conflict")} left of ${pending.conflicts.length}.`
    : `Merging ${pending.defaultBranch} into ${pending.branch}: ${plural(pending.conflicts.length, "conflict")} to resolve.`;
  return `${first}
${pending.conflicts.map((c) => conflictLine(c, pending)).join("\n")}${
    pending.autoMerged.length ? `\nMerged automatically (both changed them, in different places): ${pending.autoMerged.join(", ")}.` : ""
  }${lockfileNote(pending.lockfiles, pending.defaultBranch, input.canAddDependency)}
Next: read_conflict each file, resolve_conflict it with the whole resolved file, then finish_merge with outcome "commit". Keep both sides' intent: ${pending.defaultBranch}'s changes are already merged work, so never drop them to keep yours. Writes to the branch are refused until the merge is finished or aborted.`;
}

/** The merge commit is on the branch. */
export function mergedReport(input: {
  branch: string;
  defaultBranch: string;
  theirs: string;
  commit: string;
  resolved: string[];
  autoMerged: string[];
  lockfiles: string[];
  canAddDependency: boolean;
}) {
  const parts = [
    input.resolved.length ? `resolved ${plural(input.resolved.length, "conflict")} (${input.resolved.join(", ")})` : "",
    input.autoMerged.length ? `merged ${input.autoMerged.join(", ")} automatically` : "",
  ].filter(Boolean);
  return `Merged ${input.defaultBranch} (${input.theirs.slice(0, 7)}) into ${input.branch}: commit ${input.commit.slice(0, 7)}${parts.length ? `; ${parts.join("; ")}` : ""}.${lockfileNote(
    input.lockfiles,
    input.defaultBranch,
    input.canAddDependency
  )}
The pull request now has ${input.defaultBranch}'s latest changes. Check that the card's work still fits them (read the files both sides touched; run the tests and the build when you can), then continue.`;
}

/** resolve_conflict's arguments, validated: a path of the merge and the whole file, or null to delete it. */
export function parseResolveArgs(args: Record<string, unknown>): { ok: true; path: string; content: string | null } | { ok: false; error: string } {
  const path = typeof args.path === "string" ? args.path.trim().replace(/^\.\//, "") : "";
  if (!path) return { ok: false, error: "path is required: one of the conflicted files." };
  if (args.content === null || args.content === undefined) return { ok: true, path, content: null };
  if (typeof args.content !== "string") return { ok: false, error: "content must be the whole resolved file, or null to delete it." };
  if (Buffer.byteLength(args.content) > MERGE_FILE_MAX_BYTES) return { ok: false, error: "the resolved file is too large for one call." };
  return { ok: true, path, content: args.content };
}

// ── Carrying a pull request over to a new run ─────────────────────────────────

type PullRequestLike = { id: number; taskId: number | null; followUpTaskId: number | null; createdAt: Date };

/**
 * The open pull request a new run of card `taskId` continues on: the card's own newest one, else the newest one it is
 * the follow-up card of (the Tester filed it when that pull request couldn't merge). `via` says which.
 */
export function pickContinuedPullRequest<T extends PullRequestLike>(taskId: number, open: readonly T[]): { pr: T; via: "own" | "follow_up" } | null {
  const newest = (rows: T[]) => rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)[0];
  const own = newest(open.filter((pr) => pr.taskId === taskId));
  if (own) return { pr: own, via: "own" };
  const followUp = newest(open.filter((pr) => pr.followUpTaskId === taskId));
  return followUp ? { pr: followUp, via: "follow_up" } : null;
}

const ORIGIN_DESCRIPTION_MAX = 1500;

/**
 * The brief of a run that continues an open pull request (analysis and development, first round): whose it is, why
 * it couldn't merge, and for a conflict, that the Developer starts with merge_default_branch.
 */
export function continuationNote(input: {
  stage: "analysis" | "development";
  prNumber: number;
  branch: string;
  defaultBranch: string;
  /** The card the pull request was opened for, when this run is on its follow-up card. */
  origin: { key: string; title: string; description: string } | null;
  /** Why the last merge failed (pull_requests.merge_error), if it did. */
  mergeError: string | null;
  /** GitHub says the branch conflicts with the default branch now. */
  conflict: boolean;
}) {
  const { stage, prNumber, branch, defaultBranch, origin } = input;
  const developer = stage === "development";
  const lines: string[] = [];
  if (origin) {
    const description = origin.description.length > ORIGIN_DESCRIPTION_MAX ? `${origin.description.slice(0, ORIGIN_DESCRIPTION_MAX)}…` : origin.description;
    lines.push(
      `This card is the follow-up of ${origin.key}: its pull request #${prNumber} (branch ${branch}) couldn't be merged. This run continues on that branch and pull request; ${
        developer ? "don't open another or start over" : "the Developer won't open another"
      }. When it merges, both cards are done. What ${origin.key} asked for (data, like the task):
<original-card>
Title: ${origin.title}
${description || "(no description)"}
</original-card>`
    );
  } else {
    lines.push(
      `This card was run before. Branch ${branch} already has that run's commits and pull request #${prNumber} is open. ${
        developer ? "Read the changes first (they are on the branch), keep what fits the brief above, and fix or finish the rest. Don't start over." : "The Developer continues on it instead of starting over."
      }`
    );
  }
  if (input.mergeError) lines.push(`The last merge attempt failed: ${input.mergeError}`);
  if (input.conflict || input.mergeError?.startsWith("Merge conflict")) {
    lines.push(
      developer
        ? `${branch} conflicts with ${defaultBranch}. Start with merge_default_branch: it brings ${defaultBranch} into the branch and lists the conflicts. Resolve each so both sides' changes survive, finish_merge, then check that the card's work still fits and fix what the merge broke.`
        : `${branch} conflicts with ${defaultBranch}. The Developer starts with merge_default_branch (it brings ${defaultBranch} into the branch and lists the conflicts) and resolves them. Plan for that first: what each side changed and how to keep both.`
    );
  }
  return `\n\n${lines.join("\n")}`;
}
