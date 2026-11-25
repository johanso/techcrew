import { CORE_FILE, MEMORY_DIR, NOTES_DIR, serializeNote, slugify, type MemoryNote } from "@/lib/memory-config";
import { noteHash, noteVersion } from "@/lib/memory-hash";
import { checkNote } from "@/lib/memory-loader";
import type { ProposalEvidence, ProposalKind, ProposalNote, ProposalOrigin, ProposalTarget } from "@/lib/memory-proposals";
import { SIGNAL_KIND_LABEL, normalizeTitle } from "@/lib/memory-signals";

/**
 * The memory pull request (mode `repo`), pure: which paths it may touch, what each accepted proposal does to the files,
 * and the pull request's words. It is the only way TechTeam writes `.techteam/memory/` (agents' write tools refuse the
 * folder, lib/repo-paths.ts), and nothing outside that folder can pass memoryTreeEntries. `core` proposals go to
 * conventions.md, the rest to notes/<name>.md; retiring a note deletes its file (the history keeps it).
 */

// ── Paths and branches ─────────────────────────────────────────────────────────

const NOTE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.md$/;
// Names Windows can't check out, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Whether the memory pull request may write this path: conventions.md or a plain note file in notes/. */
export function isMemoryFilePath(path: string) {
  if (path.includes("..") || path.includes("\\")) return false;
  if (path === CORE_FILE) return true;
  if (!path.startsWith(`${NOTES_DIR}/`)) return false;
  const name = path.slice(NOTES_DIR.length + 1);
  return NOTE_FILE.test(name) && !RESERVED.test(name.split(".")[0]!);
}

/** The file a project note's key names (`project/lint` → notes/lint.md), when it is one the pull request may write. */
export function memoryFileOfKey(key: string) {
  const name = key.startsWith("project/") ? key.slice("project/".length) : "";
  const path = name === "conventions" ? CORE_FILE : `${NOTES_DIR}/${name}.md`;
  return name && isMemoryFilePath(path) ? path : null;
}

/**
 * The tree entries of a memory commit (`sha` null deletes the file). Throws on any path outside the memory folder, or
 * repeated: every commit TechTeam makes there is built from this.
 */
export function memoryTreeEntries(changes: readonly { path: string; sha: string | null }[]) {
  const seen = new Set<string>();
  return changes.map(({ path, sha }) => {
    if (!isMemoryFilePath(path)) throw new Error(`A memory pull request can't write ${JSON.stringify(path)}.`);
    if (seen.has(path.toLowerCase())) throw new Error(`A memory pull request can't write ${JSON.stringify(path)} twice.`);
    seen.add(path.toLowerCase());
    return { path, mode: "100644", type: "blob" as const, sha };
  });
}

/** `agent/memory-2026-11-25`, then `-2`, `-3` … when the name is taken. */
export function memoryBranchName(date: Date, attempt = 1) {
  return `agent/memory-${date.toISOString().slice(0, 10)}${attempt > 1 ? `-${attempt}` : ""}`;
}

/** Only these branches ever receive another memory commit. */
export const isMemoryBranch = (name: string) => /^agent\/memory-\d{4}-\d{2}-\d{2}(-\d+)?$/.test(name);

/** A free file name in notes/ for a title; `taken` holds names in lower case. */
export function noteFileName(title: string, taken: ReadonlySet<string>) {
  let slug = slugify(title);
  // notes/conventions.md would share its key with the core file.
  if (slug === "conventions" || RESERVED.test(slug)) slug = `${slug}-note`;
  for (let n = 1; ; n++) {
    const name = `${slug}${n > 1 ? `-${n}` : ""}.md`;
    if (!taken.has(name)) return name;
  }
}

// ── The commit ─────────────────────────────────────────────────────────────────

/** The memory folder at one commit: the notes the loader reads there, and the names that are taken. */
export type MemoryTree = {
  notes: readonly MemoryNote[];
  /** Everything in notes/, in lower case. */
  names: ReadonlySet<string>;
  coreExists: boolean;
};

export type CommitProposal = { id: number; kind: ProposalKind; targetKey: string | null; target: ProposalTarget | null; note: ProposalNote | null; origin: ProposalOrigin };

export type CommitPlan = {
  /** The files to write (`content` null: delete). */
  files: { path: string; content: string | null }[];
  included: { id: number; path: string }[];
  /** Proposals the repository no longer allows, with why. */
  superseded: { id: number; reason: string }[];
};

/** The note as a file, if the loader would read it back as the same note. */
function fileFor(note: ProposalNote, status: MemoryNote["status"], source: CommitProposal, path: string) {
  const content = serializeNote({ ...note, status, source: { kind: source.origin, proposal: source.id } });
  const read = checkNote(content, path, { key: "project/check", scope: "project", userId: 0, workspaceId: 0, id: null, origin: "owner" }, { core: path === CORE_FILE });
  return read.ok && read.note.title === note.title && read.note.body === note.body ? content : null;
}

/**
 * What the chosen proposals do to the memory folder, in the order they were made. `base` is the default branch, `branch`
 * where the commit goes (the same when there is no open memory pull request). A proposal whose note changed or went in
 * either place, or whose addition is already there, is superseded.
 */
export function planMemoryCommit(proposals: readonly CommitProposal[], base: MemoryTree, branch: MemoryTree): CommitPlan {
  const plan: CommitPlan = { files: [], included: [], superseded: [] };
  const taken = new Set([...base.names, ...branch.names]);
  const touched = new Set<string>();
  const added: ProposalNote[] = [];
  let coreFree = !base.coreExists && !branch.coreExists;

  for (const proposal of [...proposals].sort((a, b) => a.id - b.id)) {
    const refuse = (reason: string) => plan.superseded.push({ id: proposal.id, reason });
    const write = (path: string, content: string | null) => {
      touched.add(path);
      plan.files.push({ path, content });
      plan.included.push({ id: proposal.id, path });
    };
    const { note } = proposal;

    if (proposal.kind === "add") {
      if (!note) {
        refuse("It has no note.");
        continue;
      }
      const same = (other: Pick<ProposalNote, "title" | "body">) => normalizeTitle(other.title) === normalizeTitle(note.title) || noteHash(other) === noteHash(note);
      if ([...base.notes, ...branch.notes, ...added].some(same)) {
        refuse("A note in the repository already says this.");
        continue;
      }
      const core = coreFree && note.load === "always" && note.type === "convention";
      const path = core ? CORE_FILE : `${NOTES_DIR}/${noteFileName(note.title, taken)}`;
      const content = fileFor(note, "active", proposal, path);
      if (content === null) {
        refuse("It can't be written as a note file.");
        continue;
      }
      if (core) coreFree = false;
      else taken.add(path.slice(NOTES_DIR.length + 1));
      added.push(note);
      write(path, content);
      continue;
    }

    const find = (tree: MemoryTree) => tree.notes.find((candidate) => candidate.key === proposal.targetKey);
    const [onBase, onBranch] = [find(base), find(branch)];
    const unchanged = (found: MemoryNote | undefined) => found !== undefined && proposal.target !== null && noteVersion(found) === proposal.target.version;
    if (!unchanged(onBase) || !unchanged(onBranch) || !onBranch?.file) {
      refuse("The note changed or is gone since this was proposed.");
      continue;
    }
    const path = onBranch.file;
    if (!isMemoryFilePath(path) || touched.has(path)) {
      refuse(touched.has(path) ? "Another change in this pull request already rewrites that note." : "That file's name can't be written by TechTeam.");
      continue;
    }
    if (proposal.kind === "retire") {
      write(path, null);
      continue;
    }
    const content = note ? fileFor(note, onBranch.status, proposal, path) : null;
    if (content === null) refuse("It can't be written as a note file.");
    else write(path, content);
  }
  return plan;
}

// ── The pull request's words ───────────────────────────────────────────────────

export const memoryPrTitle = (notes: number) => `TechTeam memory: ${notes} note${notes === 1 ? "" : "s"}`;

export type PrNote = {
  kind: ProposalKind;
  /** Where it was written. */
  path: string;
  title: string;
  /** The new text; null when the note is retired. */
  body: string | null;
  rationale: string;
  evidence: readonly ProposalEvidence[];
  untrustedOrigin: boolean;
};

// Code spans and blocks: GitHub renders nothing inside them, so a note can't mention anyone, link or add markup.
const inline = (text: string) => `\`${text.replace(/`/g, "'").replace(/\s+/g, " ").trim()}\``;
function block(text: string) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

const ACTION: Record<ProposalKind, string> = { add: "Add", update: "Update", retire: "Retire (delete)" };

/** What a proposal is based on, by reference only: the words themselves stay in TechTeam. */
function evidenceLine(evidence: ProposalEvidence, cards: ReadonlyMap<number, string>) {
  if (evidence.kind === "repository") return `- Repository files: ${evidence.files.map(inline).join(", ")}`;
  const card = evidence.taskId === null ? undefined : cards.get(evidence.taskId);
  const where = [card ? `card ${inline(card)}` : "", evidence.prNumber === null ? "" : `#${evidence.prNumber}`].filter(Boolean).join(", ");
  return `- ${SIGNAL_KIND_LABEL[evidence.kind]} (${evidence.trusted ? "typed by the owner" : "from an agent, CI or GitHub"})${where ? `: ${where}` : ""}`;
}

// GitHub refuses a body over 65,536 characters.
const BODY_MAX = 60_000;

/** The pull request's description: every note it changes, why, and what that is based on. `cards`: keys by task id. */
export function memoryPrBody(notes: readonly PrNote[], cards: ReadonlyMap<number, string> = new Map()) {
  const intro = `TechTeam proposes these changes to this repository's memory (${inline(`${MEMORY_DIR}/`)}), the notes its agents read before they work. Review them like any change. TechTeam never merges this pull request; closing it without merging rejects the notes.`;
  const sections: string[] = [];
  let length = intro.length;
  for (const [index, note] of notes.entries()) {
    const section = [
      `### ${index + 1}. ${ACTION[note.kind]} ${inline(note.path)}: ${inline(note.title)}`,
      note.body === null ? "" : block(note.body),
      "**Why**",
      block(note.rationale),
      "**Based on**",
      note.evidence.map((evidence) => evidenceLine(evidence, cards)).join("\n"),
      note.untrustedOrigin ? "> Based only on text from agents, CI or the repository: check it before merging." : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (length + section.length > BODY_MAX) {
      sections.push(`… and ${notes.length - index} more, shown in the files of this pull request.`);
      break;
    }
    length += section.length;
    sections.push(section);
  }
  return [intro, ...sections].join("\n\n");
}
