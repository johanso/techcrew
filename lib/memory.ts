import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db, memoryNotes, type MemoryNoteRow, type Workspace } from "@/db";
import { GithubError, getBranchSha, getRepoFile, listRepoDir } from "@/lib/github";
import { isUniqueViolation } from "@/lib/db-errors";
import {
  MEMORY_LOADS,
  MEMORY_ORIGINS,
  MEMORY_STATUSES,
  NOTES_PER_SCOPE_MAX,
  activeNotes,
  buildMemoryBlock,
  formatMemoryResults,
  isMemoryMode,
  isMemoryType,
  rankNotes,
  slugify,
  validateNote,
  visibleNotes,
  type MemoryBlock,
  type MemoryMode,
  type MemoryNote,
  type MemoryOrigin,
  type MemoryScope,
  type NoteField,
  type NoteInput,
} from "@/lib/memory-config";
import { NO_REPO_MEMORY, blockedReason, loadRepoNotes, repoMemoryCache, type RepoMemory, type SkippedFile } from "@/lib/memory-loader";
import { blocksNote, scanMemoryNote, type MemoryScanFinding } from "@/lib/memory-scan";
import { pageSkillFile } from "@/lib/skill-runtime";

/**
 * The Brain on the server (docs/brain-plan.md): where a workspace's notes live (its memory mode), reading them (the
 * repository's files or database rows, plus the owner's global notes), the owner's CRUD for rows, and what agents
 * get: the notes they may see (visibleNotes, scanned again here, active only) and search_memory / read_memory.
 * Notes are untrusted reference data: nothing here runs them, and a bad one is skipped, never a failure for a run.
 */

type MemoryWorkspace = Pick<Workspace, "id" | "ownerId" | "githubRepoFullName" | "githubDefaultBranch" | "memoryMode">;

export const getMemoryMode = (workspace: Pick<Workspace, "memoryMode">): MemoryMode => (isMemoryMode(workspace.memoryMode) ? workspace.memoryMode : "repo");

// ── Rows ───────────────────────────────────────────────────────────────────────

/** sha256 of the normalized title and body: the same note can't be saved twice in one place. */
export function noteHash(note: Pick<NoteInput, "title" | "body">) {
  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normal(note.title)).update("\0").update(normal(note.body)).digest("hex");
}

const oneOf = <T extends string>(values: readonly T[], value: string): T | null => values.find((candidate) => candidate === value) ?? null;

/** A stored row as a note, or null when a column holds a value this version doesn't know. */
function rowToNote(row: MemoryNoteRow): MemoryNote | null {
  const scope: MemoryScope | null = row.scope === "global" || row.scope === "project" ? row.scope : null;
  const load = oneOf(MEMORY_LOADS, row.load);
  const status = oneOf(MEMORY_STATUSES, row.status);
  const origin = oneOf(MEMORY_ORIGINS, row.origin);
  if (!scope || !load || !status || !origin || !isMemoryType(row.type)) return null;
  return {
    key: `${scope}/${slugify(row.title)}-${row.id}`,
    scope,
    userId: row.userId,
    workspaceId: row.workspaceId,
    id: row.id,
    file: null,
    type: row.type,
    title: row.title,
    body: row.body,
    load,
    status,
    paths: row.paths ?? [],
    source: row.source,
    origin,
  };
}

/** The owner's rows for one place: their global notes (`workspaceId` null) or one project's. Scoped by owner. */
async function selectRows(userId: number, workspaceId: number | null) {
  return db
    .select()
    .from(memoryNotes)
    .where(and(eq(memoryNotes.userId, userId), workspaceId === null ? isNull(memoryNotes.workspaceId) : eq(memoryNotes.workspaceId, workspaceId)))
    .orderBy(asc(memoryNotes.createdAt), asc(memoryNotes.id));
}

/** Rows as notes, each checked again like a repository file; the ones that fail are returned as skipped. */
function checkedRows(rows: MemoryNoteRow[]): { notes: MemoryNote[]; skipped: SkippedFile[] } {
  const notes: MemoryNote[] = [];
  const skipped: SkippedFile[] = [];
  for (const row of rows) {
    const note = rowToNote(row);
    if (!note) {
      skipped.push({ file: `Note ${row.id}`, reason: "It holds a value this version of TechTeam doesn't know." });
      continue;
    }
    const findings = scanMemoryNote(note);
    if (blocksNote(findings)) skipped.push({ file: `Note ${row.id}`, reason: blockedReason(findings) });
    else notes.push(note);
  }
  return { notes, skipped };
}

// ── Loading ────────────────────────────────────────────────────────────────────

const repoCache = repoMemoryCache();

/** Why a project's notes couldn't be read from the repository: the owner's GitHub connection, or GitHub itself. */
export type MemoryProblem = "reconnect" | "unavailable";

/** Owners whose rejected GitHub connection this process has already reported. */
const reportedRejections = new Set<number>();

/**
 * A rejected token (401) is expected: the page asks the owner to reconnect, so the log says it once. console.error
 * would put Next's error overlay over that page, and is kept for failures nobody expects.
 */
function logUnreadableRepo(ownerId: number, error: unknown) {
  const detail = error instanceof GithubError ? `${error.status} ${error.message}` : error;
  if (!(error instanceof GithubError && error.status === 401)) {
    console.error("[memory] couldn't read the repository's notes", detail);
  } else if (!reportedRejections.has(ownerId)) {
    reportedRejections.add(ownerId);
    console.warn("[memory] couldn't read the repository's notes until GitHub is reconnected", detail);
  }
}

async function repoNotes(workspace: MemoryWorkspace, token: string | null): Promise<{ memory: RepoMemory; problem: MemoryProblem | null }> {
  if (!token) return { memory: NO_REPO_MEMORY, problem: "reconnect" };
  const { githubRepoFullName: repo, githubDefaultBranch: branch } = workspace;
  try {
    const memory = await repoCache(
      `${workspace.id}:${repo}:${branch}`,
      () => getBranchSha(token, repo, branch),
      () =>
        loadRepoNotes(
          {
            listDir: (path) => listRepoDir(token, repo, path, branch),
            readFile: async (path) => (await getRepoFile(token, repo, path, branch))?.content ?? null,
          },
          { userId: workspace.ownerId, workspaceId: workspace.id }
        )
    );
    return { memory, problem: null };
  } catch (error) {
    logUnreadableRepo(workspace.ownerId, error);
    return { memory: NO_REPO_MEMORY, problem: error instanceof GithubError && error.status === 401 ? "reconnect" : "unavailable" };
  }
}

export type LoadedMemory = {
  mode: MemoryMode;
  /** The project's notes (every status), already through visibleNotes and the scan. */
  project: MemoryNote[];
  /** The owner's global notes (every status). */
  global: MemoryNote[];
  /** Files and rows that didn't make it, with the reason. */
  skipped: SkippedFile[];
  /** Mode `repo`: the `.techteam/memory/` folder exists. */
  repoFound: boolean;
  problem: MemoryProblem | null;
};

/**
 * Everything the Brain holds for a workspace. `repo`: the repository's files at the default branch (cached about a
 * minute, read again only when the branch moved); `local`: the workspace's rows; `off`: nothing at all. The owner's
 * global notes come from rows in every mode but `off`. Never throws for a repository that can't be read: `problem` says.
 */
export async function loadMemory(workspace: MemoryWorkspace, token: string | null): Promise<LoadedMemory> {
  const mode = getMemoryMode(workspace);
  if (mode === "off") return { mode, project: [], global: [], skipped: [], repoFound: false, problem: null };
  const context = { userId: workspace.ownerId, workspaceId: workspace.id };

  const globalRows = checkedRows(await selectRows(workspace.ownerId, null));
  let project: MemoryNote[] = [];
  const skipped: SkippedFile[] = [...globalRows.skipped];
  let repoFound = false;
  let problem: MemoryProblem | null = null;
  if (mode === "repo") {
    const loaded = await repoNotes(workspace, token);
    project = loaded.memory.notes;
    skipped.push(...loaded.memory.skipped);
    repoFound = loaded.memory.found;
    problem = loaded.problem;
  } else {
    const rows = checkedRows(await selectRows(workspace.ownerId, workspace.id));
    project = rows.notes;
    skipped.push(...rows.skipped);
  }
  // The one rule for who sees what: even a loader bug can't hand over another workspace's or user's note.
  const visible = visibleNotes([...project, ...globalRows.notes], context);
  return {
    mode,
    project: visible.filter((note) => note.scope === "project"),
    global: visible.filter((note) => note.scope === "global"),
    skipped,
    repoFound,
    problem,
  };
}

/** The notes an agent of this workspace works with: visible, scanned, active. A repository that can't be read is no notes. */
export async function loadAgentMemory(workspace: MemoryWorkspace, token: string | null) {
  const loaded = await loadMemory(workspace, token);
  const notes = activeNotes([...loaded.project, ...loaded.global]);
  return { userId: workspace.ownerId, workspaceId: workspace.id, notes };
}

export type AgentMemory = Awaited<ReturnType<typeof loadAgentMemory>>;

/** The "what agents get" preview: the exact block and its numbers. */
export function agentBlock(memory: Pick<AgentMemory, "notes">): MemoryBlock {
  return buildMemoryBlock(memory.notes);
}

// ── Tools ──────────────────────────────────────────────────────────────────────

/** What an agent can reach: always filtered through visibleNotes again, whatever the caller built the list from. */
const reachable = (memory: AgentMemory) => activeNotes(visibleNotes(memory.notes, { userId: memory.userId, workspaceId: memory.workspaceId }));

/** search_memory: the best matching notes, with a boost for notes whose paths match the files being worked on. */
export function searchMemory(memory: AgentMemory, query: unknown, files: unknown) {
  const q = typeof query === "string" ? query.trim().slice(0, 200) : "";
  if (!q) return "Error: empty query.";
  const touched = Array.isArray(files) ? files.filter((file): file is string => typeof file === "string").slice(0, 50) : [];
  return formatMemoryResults(q, rankNotes(reachable(memory), q, touched));
}

/** read_memory: one page of a note, named by a key from search_memory or the Memory block. */
export function readMemory(memory: AgentMemory, key: unknown, offset: unknown) {
  const name = typeof key === "string" ? key.trim() : "";
  const note = reachable(memory).find((candidate) => candidate.key === name);
  if (!note) return `Error: no note with the key ${JSON.stringify(name.slice(0, 80))}. Use search_memory to find the right key.`;
  const content = `${note.title} (${note.type}; ${note.scope === "global" ? "the owner's own note" : "this project"})\n\n${note.body}`;
  return pageSkillFile("memory", note.key, content, typeof offset === "number" && Number.isFinite(offset) ? offset : 0);
}

// ── Owner CRUD (rows) ──────────────────────────────────────────────────────────

/** Where a row lives: the owner's global notes (`workspaceId` null) or one of their projects. */
export type NotePlace = { userId: number; workspaceId: number | null };

export type NoteWrite =
  | { ok: true; note: MemoryNote; warnings: MemoryScanFinding[] }
  | { ok: false; errors?: Partial<Record<NoteField, string>>; message?: string; findings?: MemoryScanFinding[] };

/** Validation and the scan, the same for create and update. */
function checkInput(input: unknown): { ok: true; value: NoteInput; warnings: MemoryScanFinding[] } | Extract<NoteWrite, { ok: false }> {
  const valid = validateNote(input);
  if (!valid.ok) return { ok: false, errors: valid.errors };
  const findings = scanMemoryNote(valid.value);
  if (blocksNote(findings)) return { ok: false, message: "TechTeam can't save this note: the security scan found something that would steer an agent.", findings };
  return { ok: true, value: valid.value, warnings: findings };
}

const placeWhere = (place: NotePlace) =>
  and(eq(memoryNotes.userId, place.userId), place.workspaceId === null ? isNull(memoryNotes.workspaceId) : eq(memoryNotes.workspaceId, place.workspaceId));

/** Creates a note by hand (origin owner) in the owner's global memory or a project's. At most NOTES_PER_SCOPE_MAX per place. */
export async function createMemoryNote(place: NotePlace, input: unknown, origin: MemoryOrigin = "owner"): Promise<NoteWrite> {
  const checked = checkInput(input);
  if (!checked.ok) return checked;
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(memoryNotes).where(placeWhere(place));
  if (count >= NOTES_PER_SCOPE_MAX) return { ok: false, message: `There are already ${NOTES_PER_SCOPE_MAX} notes here. Remove or merge some first.` };
  try {
    const [row] = await db
      .insert(memoryNotes)
      .values({
        userId: place.userId,
        workspaceId: place.workspaceId,
        scope: place.workspaceId === null ? "global" : "project",
        type: checked.value.type,
        title: checked.value.title,
        body: checked.value.body,
        load: checked.value.load,
        status: checked.value.status,
        paths: checked.value.paths.length ? checked.value.paths : null,
        source: checked.value.source,
        origin,
        contentHash: noteHash(checked.value),
      })
      .returning();
    const note = row && rowToNote(row);
    return note ? { ok: true, note, warnings: checked.warnings } : { ok: false, message: "The note couldn't be saved." };
  } catch (error) {
    if (isUniqueViolation(error, "memory_notes_global_unique") || isUniqueViolation(error, "memory_notes_project_unique")) {
      return { ok: false, message: "A note with the same text already exists here." };
    }
    throw error;
  }
}

/** Replaces a note's text fields (owner and place checked in the query). Its status and source stay: use setMemoryNoteStatus. */
export async function updateMemoryNote(place: NotePlace, id: number, input: unknown): Promise<NoteWrite> {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "Note not found." };
  const checked = checkInput(input);
  if (!checked.ok) return checked;
  try {
    const [row] = await db
      .update(memoryNotes)
      .set({
        type: checked.value.type,
        title: checked.value.title,
        body: checked.value.body,
        load: checked.value.load,
        paths: checked.value.paths.length ? checked.value.paths : null,
        contentHash: noteHash(checked.value),
        updatedAt: new Date(),
      })
      .where(and(eq(memoryNotes.id, id), placeWhere(place)))
      .returning();
    if (!row) return { ok: false, message: "Note not found." };
    const note = rowToNote(row);
    return note ? { ok: true, note, warnings: checked.warnings } : { ok: false, message: "The note couldn't be saved." };
  } catch (error) {
    if (isUniqueViolation(error, "memory_notes_global_unique") || isUniqueViolation(error, "memory_notes_project_unique")) {
      return { ok: false, message: "A note with the same text already exists here." };
    }
    throw error;
  }
}

/** Switches a note off (agents stop seeing it) or back on. */
export async function setMemoryNoteStatus(place: NotePlace, id: number, status: "active" | "disabled") {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const rows = await db
    .update(memoryNotes)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(memoryNotes.id, id), placeWhere(place)))
    .returning({ id: memoryNotes.id });
  return rows.length > 0;
}

export async function deleteMemoryNote(place: NotePlace, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const rows = await db
    .delete(memoryNotes)
    .where(and(eq(memoryNotes.id, id), placeWhere(place)))
    .returning({ id: memoryNotes.id });
  return rows.length > 0;
}

/** A row by id within a place (for the edit form), or null. */
export async function getMemoryNote(place: NotePlace, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db
    .select()
    .from(memoryNotes)
    .where(and(eq(memoryNotes.id, id), placeWhere(place)));
  return row ? rowToNote(row) : null;
}
