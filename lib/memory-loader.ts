import {
  CORE_FILE,
  MEMORY_DIR,
  NOTES_DIR,
  NOTE_BODY_MAX,
  NOTE_FILE_MAX_BYTES,
  REPO_NOTES_MAX,
  parseNoteFile,
  type MemoryNote,
  type NoteField,
} from "@/lib/memory-config";
import { blocksNote, scanMemoryNote, type MemoryScanFinding } from "@/lib/memory-scan";

/**
 * Reads a project's notes from the repository's `.techteam/memory/` folder (mode `repo`): `conventions.md`, the always
 * loaded core, and `notes/<name>.md`. Everything in the repository is untrusted until it passes here: a file that
 * doesn't parse, breaks a limit or trips the security scan is skipped and counted, never an error for the run. The
 * repository sits behind a small reader so the rules are tested without GitHub. Pure apart from that reader.
 */

export type RepoReader = {
  /** The files directly inside a folder, or null when it doesn't exist. */
  listDir(path: string): Promise<{ name: string; size: number }[] | null>;
  /** A text file, or null when it doesn't exist. */
  readFile(path: string): Promise<string | null>;
};

export type SkippedFile = { file: string; reason: string };

export type RepoMemory = {
  /** The folder exists (even when every file in it was skipped). */
  found: boolean;
  notes: MemoryNote[];
  skipped: SkippedFile[];
};

export const NO_REPO_MEMORY: RepoMemory = { found: false, notes: [], skipped: [] };

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

const FIELD_LABEL: Record<NoteField, string> = { title: "title", type: "type", load: "load", status: "status", paths: "paths", body: "body", source: "source" };

/** A sentence for why a note was refused: the first invalid field, or the scan's critical findings. */
export function refusalReason(errors: Partial<Record<NoteField, string>>) {
  const [field, message] = Object.entries(errors)[0] ?? [];
  return field && message ? `${FIELD_LABEL[field as NoteField]}: ${message}` : "The file is not a valid note.";
}

/** Why the scan refused a note: its critical findings, in a sentence. */
export function blockedReason(findings: readonly MemoryScanFinding[]) {
  const titles = [...new Set(findings.filter((finding) => finding.severity === "critical").map((finding) => finding.title.toLowerCase()))];
  return `Blocked by the security scan (${titles.join(", ")}).`;
}

/**
 * One note file turned into a note, or the reason it is skipped. Used for the repository's files and for rows read
 * back at load time (a row is checked again like a file: the scanner's rules may have grown since it was saved).
 */
export function checkNote(
  text: string,
  file: string,
  meta: Pick<MemoryNote, "key" | "scope" | "userId" | "workspaceId" | "id" | "origin">,
  { core }: { core: boolean }
): { ok: true; note: MemoryNote } | { ok: false; reason: string } {
  const parsed = parseNoteFile(text, { core });
  if (!parsed.ok) return { ok: false, reason: refusalReason(parsed.errors) };
  const findings = scanMemoryNote(parsed.value);
  if (blocksNote(findings)) return { ok: false, reason: blockedReason(findings) };
  return { ok: true, note: { ...meta, file, ...parsed.value } };
}

/** The key agents name a repository note by: the file name without `.md`. */
const keyOf = (name: string) => `project/${name.replace(/\.md$/i, "").toLowerCase()}`;

/**
 * Loads `.techteam/memory/` through `reader`. A missing folder is "no memory". Files are read in name order (the core
 * first), at most REPO_NOTES_MAX of them; a file over NOTE_FILE_MAX_BYTES is never downloaded.
 */
export async function loadRepoNotes(reader: RepoReader, owner: { userId: number; workspaceId: number }): Promise<RepoMemory> {
  const root = await reader.listDir(MEMORY_DIR);
  if (!root) return NO_REPO_MEMORY;
  const notes: MemoryNote[] = [];
  const skipped: SkippedFile[] = [];

  const read = async (path: string, size: number, name: string, core: boolean) => {
    if (size > NOTE_FILE_MAX_BYTES) {
      skipped.push({ file: path, reason: `Larger than ${NOTE_FILE_MAX_BYTES} bytes. A note is at most ${NOTE_BODY_MAX} characters.` });
      return;
    }
    const text = await reader.readFile(path);
    if (text === null) {
      skipped.push({ file: path, reason: "The file couldn't be read." });
      return;
    }
    const checked = checkNote(
      text,
      path,
      { key: core ? "project/conventions" : keyOf(name), scope: "project", userId: owner.userId, workspaceId: owner.workspaceId, id: null, origin: "owner" },
      { core }
    );
    if (checked.ok) notes.push(checked.note);
    else skipped.push({ file: path, reason: checked.reason });
  };

  const core = root.find((entry) => entry.name === "conventions.md");
  if (core) await read(CORE_FILE, core.size, core.name, true);

  const folder = (await reader.listDir(NOTES_DIR)) ?? [];
  const files = folder.filter((entry) => FILE_NAME.test(entry.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of folder.filter((candidate) => !FILE_NAME.test(candidate.name))) {
    skipped.push({ file: `${NOTES_DIR}/${entry.name}`, reason: "Only Markdown files (.md) with a plain name are read." });
  }
  for (const entry of files.slice(0, REPO_NOTES_MAX)) await read(`${NOTES_DIR}/${entry.name}`, entry.size, entry.name, false);
  for (const entry of files.slice(REPO_NOTES_MAX)) skipped.push({ file: `${NOTES_DIR}/${entry.name}`, reason: `Beyond the first ${REPO_NOTES_MAX} notes.` });

  return { found: true, notes, skipped };
}

/**
 * A short-lived cache of a repository's notes. Within `ttlMs` the answer is reused; after it, the head commit is asked
 * for (one cheap request) and the notes are only read again when it moved. Keyed by workspace, repository and branch.
 */
export function repoMemoryCache(ttlMs = 60_000, now: () => number = Date.now, maxEntries = 50) {
  const entries = new Map<string, { at: number; sha: string | null; value: RepoMemory }>();
  return async function cached(key: string, headSha: () => Promise<string | null>, load: () => Promise<RepoMemory>): Promise<RepoMemory> {
    const entry = entries.get(key);
    if (entry && now() - entry.at < ttlMs) return entry.value;
    const sha = await headSha();
    if (entry && sha !== null && entry.sha === sha) {
      entry.at = now();
      return entry.value;
    }
    const value = await load();
    entries.delete(key);
    entries.set(key, { at: now(), sha, value });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    return value;
  };
}
