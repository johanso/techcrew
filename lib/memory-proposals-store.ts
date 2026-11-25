import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { db, memoryProposals, tasks, type MemoryProposalRow, type Workspace } from "@/db";
import { taskKeyPrefix } from "@/lib/agents";
import {
  GithubError,
  createBlob,
  createBranch,
  createCommit,
  createPullRequest,
  deleteBranch,
  fastForwardBranch,
  getBranchSha,
  getCommit,
  getGithubToken,
  getPullRequest,
  getTreeLevel,
  updatePullRequest,
} from "@/lib/github";
import { checkProposalNote } from "@/lib/librarian";
import { createMemoryNote, getMemoryMode, getMemoryNote, repoReader, setMemoryNoteStatus, updateMemoryNote, type Executor, type LoadedMemory, type NotePlace } from "@/lib/memory";
import { MEMORY_SCOPES, type MemoryNote } from "@/lib/memory-config";
import {
  isMemoryBranch,
  memoryBranchName,
  memoryFileOfKey,
  memoryPrBody,
  memoryPrTitle,
  memoryTreeEntries,
  planMemoryCommit,
  type MemoryTree,
  type PrNote,
} from "@/lib/memory-files";
import { noteVersion } from "@/lib/memory-hash";
import { loadRepoNotes } from "@/lib/memory-loader";
import { PROPOSAL_ORIGINS, deliveryOf, isProposalKind, type ProposalNote, type ProposalStatus, type ProposalView } from "@/lib/memory-proposals";
import type { MemoryScanFinding } from "@/lib/memory-scan";

/**
 * The inbox on the server (docs/brain-plan.md, "How a proposal arrives"): what waits for the owner, accepting, editing
 * and rejecting, and the memory pull request. Callers have authorized the workspace; every query also names its owner.
 * Notes are checked again when written. Nothing reaches the repository except through openMemoryPullRequest, the
 * owner's click, and TechTeam never merges that pull request.
 */

type ProposalWorkspace = Pick<Workspace, "id" | "ownerId" | "name" | "memoryMode" | "githubRepoFullName" | "githubRepoUrl" | "githubDefaultBranch">;

/** A row whose enum columns this version knows. */
function readRow(row: MemoryProposalRow) {
  const scope = MEMORY_SCOPES.find((candidate) => candidate === row.scope);
  const origin = PROPOSAL_ORIGINS.find((candidate) => candidate === row.origin);
  const { kind } = row;
  if (!scope || !origin || !isProposalKind(kind)) return null;
  return { ...row, scope, origin, kind };
}

type Proposal = NonNullable<ReturnType<typeof readRow>>;

/** This workspace's proposals, as its owner's. */
const owned = (workspace: Pick<Workspace, "id" | "ownerId">) => and(eq(memoryProposals.workspaceId, workspace.id), eq(memoryProposals.userId, workspace.ownerId));

// ── Reading ────────────────────────────────────────────────────────────────────

/** The proposals waiting for the owner or in the memory pull request, oldest first. `memory`: the notes as loaded now. */
export async function listProposals(workspace: ProposalWorkspace, memory: LoadedMemory): Promise<ProposalView[]> {
  const rows = await db
    .select()
    .from(memoryProposals)
    .where(and(owned(workspace), inArray(memoryProposals.status, ["pending", "in_pr"])))
    .orderBy(asc(memoryProposals.id));
  const cards = await cardKeys(workspace, rows);
  const notes = [...memory.project, ...memory.global];
  // With memory off, or a repository that can't be read, there is nothing to compare a target with.
  const comparable = memory.mode !== "off" && !memory.problem;

  return rows.flatMap((raw): ProposalView[] => {
    const row = readRow(raw);
    if (!row || (row.status !== "pending" && row.status !== "in_pr")) return [];
    const now = row.targetKey ? notes.find((note) => note.key === row.targetKey) : undefined;
    return [
      {
        id: row.id,
        kind: row.kind,
        scope: row.scope,
        status: row.status,
        note: row.note,
        targetKey: row.targetKey,
        current: now ? proposalNoteOf(now) : (row.target?.note ?? null),
        targetChanged: comparable && row.status === "pending" && row.target !== null && (!now || noteVersion(now) !== row.target.version),
        rationale: row.rationale,
        evidence: row.evidence.map((evidence) => {
          if (evidence.kind === "repository") return evidence;
          const key = evidence.taskId === null ? undefined : cards.get(evidence.taskId);
          return {
            ...evidence,
            card: key && evidence.taskId !== null ? { id: evidence.taskId, key } : null,
            prUrl: evidence.prNumber === null ? null : `${workspace.githubRepoUrl}/pull/${evidence.prNumber}`,
          };
        }),
        untrustedOrigin: row.untrustedOrigin,
        origin: row.origin,
        pullRequest: row.prNumber === null ? null : { number: row.prNumber, url: `${workspace.githubRepoUrl}/pull/${row.prNumber}` },
        createdAt: row.createdAt,
      },
    ];
  });
}

const proposalNoteOf = (note: MemoryNote): ProposalNote => ({ title: note.title, type: note.type, load: note.load, paths: note.paths, body: note.body });

/** The keys of the cards the proposals' evidence names, by task id, only of this workspace. */
async function cardKeys(workspace: Pick<Workspace, "id" | "name">, rows: readonly Pick<MemoryProposalRow, "evidence">[]) {
  const ids = [...new Set(rows.flatMap((row) => row.evidence.flatMap((e) => (e.kind !== "repository" && e.taskId !== null ? [e.taskId] : []))))];
  if (!ids.length) return new Map<number, string>();
  const found = await db
    .select({ id: tasks.id, number: tasks.number })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspace.id), inArray(tasks.id, ids)));
  return new Map(found.map((task) => [task.id, `${taskKeyPrefix(workspace.name)}-${task.number}`]));
}

// ── The inbox ──────────────────────────────────────────────────────────────────

export type ProposalWrite =
  | { ok: true; message?: string }
  | { ok: false; message: string; errors?: Partial<Record<keyof ProposalNote, string>>; findings?: MemoryScanFinding[] };

const refuse = (message: string, extra: Omit<Extract<ProposalWrite, { ok: false }>, "ok" | "message"> = {}): ProposalWrite => ({ ok: false, message, ...extra });

const DECIDED = "That proposal isn't waiting any more. Reload the page.";
const OFF = "Memory is off for this project. Turn it on to decide on proposals.";
const CONFIRM = "This is based only on text from agents, CI or the repository. Confirm that you checked it before accepting.";

/** Rolls the transaction back with an answer for the owner. */
class Refusal extends Error {
  constructor(readonly answer: ProposalWrite) {
    super("refused");
  }
}

/** The pending proposal, locked until the transaction ends, so two clicks can't decide it twice. */
async function lockPending(tx: Executor, workspace: ProposalWorkspace, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await tx
    .select()
    .from(memoryProposals)
    .where(and(owned(workspace), eq(memoryProposals.id, id), eq(memoryProposals.status, "pending")))
    .for("update");
  return row ? readRow(row) : null;
}

const decide = (tx: Executor, id: number, status: ProposalStatus, note?: ProposalNote) =>
  tx
    .update(memoryProposals)
    .set({ status, ...(note ? { note } : {}), updatedAt: new Date() })
    .where(eq(memoryProposals.id, id));

/** The row id a database note's key ends with (`global/small-prs-3`). */
const noteIdOf = (key: string | null) => Number(/-(\d+)$/.exec(key ?? "")?.[1] ?? Number.NaN);

/** Writes an accepted proposal into the notes: a new note, the new text of one, or (retire) a note switched off. */
async function writeNote(tx: Executor, place: NotePlace, proposal: Proposal, edit: unknown): Promise<ProposalWrite> {
  let noteId = Number.NaN;
  if (proposal.kind !== "add") {
    noteId = noteIdOf(proposal.targetKey);
    const current = await getMemoryNote(place, noteId, tx);
    if (!current || noteVersion(current) !== proposal.target?.version) {
      await decide(tx, proposal.id, "superseded");
      return refuse("The note changed since this was proposed, so nothing was written. The proposal is marked as superseded.");
    }
  }
  if (proposal.kind === "retire") {
    await setMemoryNoteStatus(place, noteId, "disabled", tx);
    await decide(tx, proposal.id, "accepted");
    return { ok: true, message: "The note is switched off." };
  }
  const checked = checkProposalNote(edit ?? proposal.note, proposal.scope);
  if (!checked.ok) return refuse("The note can't be saved as it is.", { errors: checked.errors, findings: checked.findings });
  const input = { ...checked.note, status: "active", source: { kind: "proposal", proposal: proposal.id } };
  const written = proposal.kind === "add" ? await createMemoryNote(place, input, proposal.origin, tx) : await updateMemoryNote(place, noteId, input, tx);
  // A failed insert leaves the transaction unusable: leave it by throwing.
  if (!written.ok) throw new Refusal(refuse(written.message ?? "The note couldn't be saved.", { errors: written.errors, findings: written.findings }));
  await decide(tx, proposal.id, "accepted", checked.note);
  return { ok: true, message: proposal.kind === "add" ? "Added to the notes." : "The note is updated." };
}

/**
 * Accepts a proposal on the page (the owner's notes, and project notes in mode `local`), with the owner's edit if any
 * (`edit` null: as proposed). One proposed from untrusted text needs `confirmed`. A target that changed since marks the
 * proposal superseded and writes nothing.
 */
export async function acceptProposal(workspace: ProposalWorkspace, id: number, { edit, confirmed }: { edit: unknown; confirmed: boolean }): Promise<ProposalWrite> {
  const mode = getMemoryMode(workspace);
  try {
    return await db.transaction(async (tx) => {
      const proposal = await lockPending(tx, workspace, id);
      if (!proposal) return refuse(DECIDED);
      const delivery = deliveryOf(proposal.scope, mode);
      if (!delivery) return refuse(OFF);
      if (delivery !== "inbox") return refuse("Project notes go to the repository in this mode: select the proposal and open the memory pull request.");
      if (proposal.untrustedOrigin && !confirmed) return refuse(CONFIRM);
      const place = { userId: workspace.ownerId, workspaceId: proposal.scope === "global" ? null : workspace.id };
      return writeNote(tx, place, proposal, edit);
    });
  } catch (error) {
    if (error instanceof Refusal) return error.answer;
    throw error;
  }
}

/** Saves the owner's edit of a proposal that stays waiting (for the memory pull request). */
export async function editProposal(workspace: ProposalWorkspace, id: number, edit: unknown): Promise<ProposalWrite> {
  const mode = getMemoryMode(workspace);
  return db.transaction(async (tx) => {
    const proposal = await lockPending(tx, workspace, id);
    if (!proposal || proposal.kind === "retire") return refuse(DECIDED);
    if (!deliveryOf(proposal.scope, mode)) return refuse(OFF);
    const checked = checkProposalNote(edit, proposal.scope);
    if (!checked.ok) return refuse("The note can't be saved as it is.", { errors: checked.errors, findings: checked.findings });
    await decide(tx, proposal.id, "pending", checked.note);
    return { ok: true, message: "Saved. It still waits for you." };
  });
}

/** Rejects a proposal; the librarian won't make it again. */
export async function rejectProposal(workspace: ProposalWorkspace, id: number): Promise<ProposalWrite> {
  if (getMemoryMode(workspace) === "off") return refuse(OFF);
  if (!Number.isSafeInteger(id) || id <= 0) return refuse(DECIDED);
  const rows = await db
    .update(memoryProposals)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(owned(workspace), eq(memoryProposals.id, id), eq(memoryProposals.status, "pending")))
    .returning({ id: memoryProposals.id });
  return rows.length ? { ok: true } : refuse(DECIDED);
}

// ── The memory pull request ────────────────────────────────────────────────────

// Proposals marked as being sent for longer than this were cut off (TechTeam stopped mid-way).
const SENDING_STALE_MS = 5 * 60_000;

const sending = (workspace: Pick<Workspace, "id" | "ownerId">) => and(owned(workspace), eq(memoryProposals.status, "in_pr"), isNull(memoryProposals.prNumber));

/**
 * Brings the proposals in memory pull requests up to date with GitHub: merged ones become `merged`, closed ones
 * `rejected`. Returns how many pull requests ended, and whether any couldn't be checked.
 */
export async function refreshMemoryPullRequests(workspace: ProposalWorkspace) {
  const stale = new Date(Date.now() - SENDING_STALE_MS);
  await db
    .update(memoryProposals)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(sending(workspace), lt(memoryProposals.updatedAt, stale)));
  const rows = await db
    .selectDistinct({ number: memoryProposals.prNumber })
    .from(memoryProposals)
    .where(and(owned(workspace), eq(memoryProposals.status, "in_pr"), isNotNull(memoryProposals.prNumber)));
  const result = { ended: 0, unchecked: false };
  if (!rows.length) return result;
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return { ...result, unchecked: true };
  for (const { number } of rows) {
    if (number === null) continue;
    try {
      const pr = await getPullRequest(token, workspace.githubRepoFullName, number);
      if (!pr.merged && pr.state === "open") continue;
      await db
        .update(memoryProposals)
        .set({ status: pr.merged ? "merged" : "rejected", updatedAt: new Date() })
        .where(and(owned(workspace), eq(memoryProposals.status, "in_pr"), eq(memoryProposals.prNumber, number)));
      result.ended++;
    } catch (error) {
      console.warn(`[memory] couldn't check pull request #${number}: ${error instanceof Error ? error.message : "unknown error"}`);
      result.unchecked = true;
    }
  }
  return result;
}

/**
 * Marks the chosen proposals as being sent, one send at a time per workspace (also across the owner's computers). All
 * of them must be waiting project proposals, and each untrusted one confirmed.
 */
function claim(workspace: ProposalWorkspace, ids: number[], confirmed: ReadonlySet<number>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('memory-pull-request'), ${workspace.id})`);
    const busy = await tx.select({ id: memoryProposals.id }).from(memoryProposals).where(sending(workspace)).limit(1);
    if (busy.length) return "A memory pull request is already being prepared. Wait a moment and reload.";
    const rows = await tx
      .select()
      .from(memoryProposals)
      .where(and(owned(workspace), eq(memoryProposals.status, "pending"), eq(memoryProposals.scope, "project"), inArray(memoryProposals.id, ids)))
      .for("update");
    if (rows.length !== ids.length) return "Some of those proposals aren't waiting any more. Reload the page and choose again.";
    if (rows.some((row) => row.untrustedOrigin && !confirmed.has(row.id))) return CONFIRM;
    await tx
      .update(memoryProposals)
      .set({ status: "in_pr", prNumber: null, updatedAt: new Date() })
      .where(and(owned(workspace), inArray(memoryProposals.id, ids)));
    return rows.flatMap((row) => readRow(row) ?? []);
  });
}

/** A failure with words for the owner. */
class SendFailure extends Error {}

/** The memory folder at a commit: what the loader reads there, and which names are taken. */
async function memoryTreeAt(token: string, workspace: ProposalWorkspace, sha: string): Promise<{ treeSha: string; tree: MemoryTree }> {
  const repo = workspace.githubRepoFullName;
  const { treeSha } = await getCommit(token, repo, sha);
  // Level by level: a folder that is a file or a link there would be replaced by writing under it.
  const open = async (parent: Awaited<ReturnType<typeof getTreeLevel>>, name: string) => {
    const entry = parent.find((candidate) => candidate.name === name);
    if (!entry) return [];
    if (entry.type !== "tree") throw new SendFailure(`“${name}” in the repository isn't a folder, so TechTeam won't write there.`);
    return getTreeLevel(token, repo, entry.sha);
  };
  const memory = await open(await open(await getTreeLevel(token, repo, treeSha), ".techteam"), "memory");
  const names = (await open(memory, "notes")).map((entry) => entry.name.toLowerCase());
  const loaded = await loadRepoNotes(repoReader(token, repo, sha), { userId: workspace.ownerId, workspaceId: workspace.id });
  return { treeSha, tree: { notes: loaded.notes, names: new Set(names), coreExists: memory.some((entry) => entry.name.toLowerCase() === "conventions.md") } };
}

/** The open memory pull request to add to: the newest TechTeam opened that is still open, on its own branch here. */
async function openMemoryPr(token: string, workspace: ProposalWorkspace) {
  const rows = await db
    .selectDistinct({ number: memoryProposals.prNumber })
    .from(memoryProposals)
    .where(and(owned(workspace), eq(memoryProposals.status, "in_pr"), isNotNull(memoryProposals.prNumber)));
  const numbers = rows.flatMap((row) => row.number ?? []).sort((a, b) => b - a);
  const repo = workspace.githubRepoFullName;
  for (const number of numbers) {
    const pr = await getPullRequest(token, repo, number);
    if (pr.state === "open" && pr.headRepo?.toLowerCase() === repo.toLowerCase() && isMemoryBranch(pr.headRef) && pr.baseRef === workspace.githubDefaultBranch) return pr;
  }
  return null;
}

/** A new branch at `sha`, named by today's date, with a number when that name is taken. */
async function createMemoryBranch(token: string, repo: string, sha: string) {
  const today = new Date();
  for (let attempt = 1; attempt <= 30; attempt++) {
    const branch = memoryBranchName(today, attempt);
    if (await getBranchSha(token, repo, branch)) continue;
    await createBranch(token, repo, branch, sha);
    return branch;
  }
  throw new SendFailure("There are too many memory branches from today. Delete the old ones on GitHub.");
}

const prNote = (row: Proposal, path: string): PrNote => ({
  kind: row.kind,
  path,
  title: row.note?.title ?? row.target?.note.title ?? "",
  body: row.note?.body ?? null,
  rationale: row.rationale,
  evidence: row.evidence,
  untrustedOrigin: row.untrustedOrigin,
});

/** One commit with the claimed proposals, on the open memory pull request's branch or a new one with its pull request. */
async function send(token: string, workspace: ProposalWorkspace, rows: Proposal[]): Promise<ProposalWrite> {
  const { githubRepoFullName: repo, githubDefaultBranch: base } = workspace;
  const pr = await openMemoryPr(token, workspace);
  const baseSha = await getBranchSha(token, repo, base);
  if (!baseSha) throw new SendFailure(`The branch ${base} wasn't found in ${repo}.`);
  const onBase = await memoryTreeAt(token, workspace, baseSha);
  const onBranch = pr ? await memoryTreeAt(token, workspace, pr.headSha) : onBase;
  const plan = planMemoryCommit(rows, onBase.tree, onBranch.tree);

  if (plan.superseded.length) {
    await db
      .update(memoryProposals)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(sending(workspace), inArray(memoryProposals.id, plan.superseded.map((item) => item.id))));
  }
  const left = plan.superseded.length ? ` ${plan.superseded.length} superseded: ${[...new Set(plan.superseded.map((item) => item.reason))].join(" ")}` : "";
  if (!plan.included.length) return refuse(`Nothing was written.${left}`);

  const files = await Promise.all(plan.files.map(async (file) => ({ path: file.path, sha: file.content === null ? null : await createBlob(token, repo, file.content) })));
  const commit = await createCommit(token, repo, {
    baseTreeSha: onBranch.treeSha,
    // The guard: nothing outside .techteam/memory/ gets into a tree.
    entries: memoryTreeEntries(files),
    parents: [pr?.headSha ?? baseSha],
    message: memoryPrTitle(plan.included.length),
  });

  const paths = new Map(plan.included.map((item) => [item.id, item.path]));
  const cards = await cardKeys(workspace, rows);
  let number: number;
  if (pr) {
    await fastForwardBranch(token, repo, pr.headRef, commit);
    number = pr.number;
  } else {
    const added = rows.flatMap((row) => (paths.has(row.id) ? [prNote(row, paths.get(row.id)!)] : []));
    const branch = await createMemoryBranch(token, repo, commit);
    try {
      number = (await createPullRequest(token, repo, { title: memoryPrTitle(added.length), body: memoryPrBody(added, cards), head: branch, base })).number;
    } catch (error) {
      // The branch was made for this pull request only.
      await deleteBranch(token, repo, branch).catch(() => console.warn(`[memory] couldn't delete the branch ${branch}`));
      throw error;
    }
  }
  await db
    .update(memoryProposals)
    .set({ prNumber: number, updatedAt: new Date() })
    .where(and(sending(workspace), inArray(memoryProposals.id, [...paths.keys()])));
  if (pr) await describePullRequest(token, workspace, number, onBranch.tree, paths);
  return { ok: true, message: `${pr ? `Added a commit to pull request #${number}` : `Opened pull request #${number}`}.${left}` };
}

/**
 * After another commit: the pull request's title and description list every note it carries. `before` is the branch as
 * it was, `paths` where this commit's proposals went.
 */
async function describePullRequest(token: string, workspace: ProposalWorkspace, number: number, before: MemoryTree, paths: ReadonlyMap<number, string>) {
  try {
    const rows = await db
      .select()
      .from(memoryProposals)
      .where(and(owned(workspace), eq(memoryProposals.status, "in_pr"), eq(memoryProposals.prNumber, number)))
      .orderBy(asc(memoryProposals.id));
    const notes = rows.flatMap((raw): PrNote[] => {
      const row = readRow(raw);
      if (!row) return [];
      // An earlier commit's note is found by the proposal named in its source, or by the note it changed.
      const path = paths.get(row.id) ?? before.notes.find((note) => note.source.proposal === row.id)?.file ?? (row.targetKey ? memoryFileOfKey(row.targetKey) : null);
      return path ? [prNote(row, path)] : [];
    });
    await updatePullRequest(token, workspace.githubRepoFullName, number, { title: memoryPrTitle(notes.length), body: memoryPrBody(notes, await cardKeys(workspace, rows)) });
  } catch (error) {
    console.warn(`[memory] couldn't update the description of pull request #${number}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function sendFailureMessage(error: unknown) {
  if (error instanceof SendFailure) return error.message;
  if (error instanceof GithubError) {
    if (error.status === 401) return "GitHub rejected the saved connection. Reconnect GitHub and try again.";
    if (error.status === 403 || error.status === 404) return "GitHub didn't let TechTeam write to the repository. Check the connection's access to it.";
    if (error.status === 422 || error.status === 409) return "The repository changed while writing, so nothing was sent. Try again.";
    return `GitHub refused: ${error.message}`;
  }
  console.error("[memory] the memory pull request failed", error);
  return "The pull request couldn't be opened. Please try again.";
}

/**
 * "Open memory pull request", the only way notes reach the repository: one commit that touches only .techteam/memory/,
 * on a new `agent/memory-<date>` branch with its pull request, or on the open one's branch (forward only). If it fails,
 * the proposals wait again.
 */
export async function openMemoryPullRequest(workspace: ProposalWorkspace, ids: number[], confirmed: number[]): Promise<ProposalWrite> {
  if (getMemoryMode(workspace) !== "repo") return refuse("The memory pull request is only for mode “In the repository”.");
  const chosen = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!chosen.length) return refuse("Select at least one proposal.");
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return refuse("GitHub rejected the saved connection, or there is none. Connect GitHub and try again.");
  // A closed pull request's proposals are decided first, so nothing is added to it.
  await refreshMemoryPullRequests(workspace);
  const claimed = await claim(workspace, chosen, new Set(confirmed));
  if (typeof claimed === "string") return refuse(claimed);
  try {
    return await send(token, workspace, claimed);
  } catch (error) {
    await db
      .update(memoryProposals)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(sending(workspace), inArray(memoryProposals.id, chosen)));
    return refuse(sendFailureMessage(error));
  }
}
