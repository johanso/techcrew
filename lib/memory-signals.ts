import { TOOL_LABEL } from "@/lib/agent-run-config";
import { MEMORY_TYPES, NOTE_BODY_MAX, NOTE_TITLE_MAX, isMemoryType, type MemoryType } from "@/lib/memory-config";
import { blocksNote, scanMemoryNote, type MemoryScanFinding } from "@/lib/memory-scan";

/**
 * Brain signals (docs/brain-plan.md, "How it learns"): what happened that the memory could learn from. Pure and
 * client-safe: the vocabulary and limits, the builders that turn an event into a signal (capped, scanned, with its
 * dedupe key and trusted flag), the Lead's lessons, whether to ask why a pull request was rejected, and retention.
 * lib/memory-signals-store.ts writes them. Agents have no tool to read them.
 *
 * Trust: `trusted` describes a signal's `title` and `text`, and is true only for words the owner typed in the app.
 * `context` and `evidence` are always someone else's words, whatever the flag says.
 */

// ── Vocabulary ─────────────────────────────────────────────────────────────────

/** `failure` is in the plan's data model but nothing records it yet (run failures are classified in a later version). */
export const SIGNAL_KINDS = ["pr_rejected", "rework", "answer", "failure", "lesson", "remember"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const isSignalKind = (value: unknown): value is SignalKind => SIGNAL_KINDS.includes(value as SignalKind);

export const REJECTION_REASONS = ["not_asked", "wrong_approach", "style", "too_big", "not_needed", "other"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const isRejectionReason = (value: unknown): value is RejectionReason => REJECTION_REASONS.includes(value as RejectionReason);
export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  not_asked: "Not what I asked",
  wrong_approach: "Wrong approach",
  style: "Style or conventions",
  too_big: "Too big",
  not_needed: "Not needed",
  other: "Other",
};

/** pull_requests.rejection_prompt: the question about a closed pull request, and what became of it (null: never asked). */
export const REJECTION_PROMPTS = ["pending", "answered", "dismissed"] as const;
export type RejectionPromptState = (typeof REJECTION_PROMPTS)[number];

/** What sends a run back to the Developer. */
export const REWORK_CAUSES = ["ci", "lead", "tests"] as const;
export type ReworkCause = (typeof REWORK_CAUSES)[number];
export const REWORK_CAUSE_LABEL: Record<ReworkCause, string> = { ci: "CI failed", lead: "The Lead sent it back", tests: "Tests failed" };

export const SIGNAL_SCOPES = ["project", "global"] as const;
export type SignalScope = (typeof SIGNAL_SCOPES)[number];
export const isSignalScope = (value: unknown): value is SignalScope => SIGNAL_SCOPES.includes(value as SignalScope);
export const SIGNAL_SCOPE_LABEL: Record<SignalScope, string> = { project: "This project", global: "Everything" };

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  pr_rejected: "Pull request rejected",
  rework: "Rework",
  answer: "Your answer",
  failure: "Run failure",
  lesson: "Lesson",
  remember: "Remembered",
};

// ── Limits ─────────────────────────────────────────────────────────────────────

export const SIGNAL_TEXT_MAX = NOTE_BODY_MAX;
export const LESSON_TITLE_MAX = NOTE_TITLE_MAX;
export const LESSON_EVIDENCE_MAX = 500;
export const LESSONS_MAX = 3;
export const REMEMBER_MAX = 600;
export const SIGNALS_PER_WORKSPACE_MAX = 500;
/** The Brain page's Activity list grows in these steps. */
export const SIGNALS_PAGE_SIZE = 20;
// Text beyond this is never looked at, so it is never stored either: it bounds what the scanner reads.
const SCAN_INPUT_MAX = 20_000;

// ── When ───────────────────────────────────────────────────────────────────────

/**
 * Whether TechTeam collects signals on its own, and asks about rejected pull requests, for a workspace's memory mode
 * (workspaces.memory_mode): never when it is `off`, or when there is no mode to read. "Remember this" doesn't ask this:
 * it is the owner's own action and always available.
 */
export const collectsSignals = (memoryMode: string | null | undefined) => typeof memoryMode === "string" && memoryMode !== "off";

// ── The signal ─────────────────────────────────────────────────────────────────

export type SignalPayload = {
  /** The signal's own words: the owner's note or answer, the feedback, the lesson. Empty for a reason without a note. */
  text: string;
  /** Lessons. */
  title?: string;
  /** What the owner replied to (the Analyst's question). Always untrusted. */
  context?: string;
  reason?: RejectionReason;
  cause?: ReworkCause;
  round?: number;
  type?: MemoryType;
  evidence?: string;
  scope?: SignalScope;
};

export type SignalDraft = {
  kind: SignalKind;
  /** Unique per workspace and kind: the same event recorded again is the same signal. */
  sourceKey: string;
  trusted: boolean;
  payload: SignalPayload;
  /** The owner's own input: saving it again replaces what is stored. Everything else keeps the first. */
  replace: boolean;
};

export type SignalField = "reason" | "text" | "scope";

export type BuiltSignal =
  /** `dropped`: texts the security scan removed from a signal that is still worth keeping. */
  | { ok: true; draft: SignalDraft; dropped: number }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "invalid"; errors: Partial<Record<SignalField, string>> }
  /** The security scan refused it: nothing is stored. */
  | { ok: false; reason: "blocked"; findings: MemoryScanFinding[] };

// ── Text ───────────────────────────────────────────────────────────────────────

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const NOT_PRINTABLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F�]/g;

/** A person's or a model's text, with one kind of line break. Lone surrogates can't be stored as JSON. */
const normalize = (value: unknown) =>
  typeof value === "string" ? value.slice(0, SCAN_INPUT_MAX).toWellFormed().replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";

/** Output of tools and CI: terminal colors and stray control bytes are noise there, not something hidden. */
const machineText = (value: string) => normalize(normalize(value.replace(ANSI, "")).replace(NOT_PRINTABLE, ""));

/** At most `max` characters, cut with an ellipsis and never through the middle of a character pair. */
export function capText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}

/** The scan's findings when it refuses the text, else null (warnings don't stop a signal). */
function refused(title: string, body: string) {
  const findings = scanMemoryNote({ title, body });
  return blocksNote(findings) ? findings : null;
}

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** A short stable key for a long text (FNV-1a, two seeds): only for telling one owner's notes apart. */
function textKey(value: string) {
  const hash = (seed: number) => {
    let h = seed;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0xcbf29ce4)}`;
}

// ── Builders ───────────────────────────────────────────────────────────────────

/** Why the owner closed a pull request without merging it: a choice and, if they wrote one, a note. */
export function buildRejectionSignal(input: { prNumber: number; reason: unknown; note: unknown }): BuiltSignal {
  const note = normalize(input.note);
  const errors: Partial<Record<SignalField, string>> = {};
  if (!isRejectionReason(input.reason)) errors.reason = "Choose why it was rejected.";
  if (note.length > SIGNAL_TEXT_MAX) errors.text = `Keep it to ${SIGNAL_TEXT_MAX} characters (this has ${note.length}).`;
  if (!isRejectionReason(input.reason) || errors.text) return { ok: false, reason: "invalid", errors };
  const findings = note ? refused("", note) : null;
  if (findings) return { ok: false, reason: "blocked", findings };
  return {
    ok: true,
    dropped: 0,
    draft: { kind: "pr_rejected", sourceKey: `pr:${input.prNumber}`, trusted: true, payload: { text: note, reason: input.reason }, replace: true },
  };
}

/** What sent a run back to the Developer: the Lead's changes, the failed tests or the failing checks, item by item. */
export function buildReworkSignal(input: { runId: number; round: number; cause: ReworkCause; feedback: readonly string[] }): BuiltSignal {
  const items = input.feedback.map(machineText).filter(Boolean);
  if (!items.length) return { ok: false, reason: "empty" };
  // One refused item (a link in a CI message, say) doesn't cost the rest.
  const findings: MemoryScanFinding[] = [];
  const kept = items.filter((item) => {
    const found = refused("", item);
    if (found) findings.push(...found);
    return !found;
  });
  const text = capText(kept.join("\n"), SIGNAL_TEXT_MAX);
  const joined = text ? refused("", text) : null;
  if (!text || joined) return { ok: false, reason: "blocked", findings: joined ?? findings };
  return {
    ok: true,
    dropped: items.length - kept.length,
    draft: {
      kind: "rework",
      sourceKey: `run:${input.runId}:round:${input.round}:${input.cause}`,
      trusted: false,
      payload: { text, cause: input.cause, round: input.round },
      replace: false,
    },
  };
}

/** The owner's answer to the Analyst, with the question (the model's words) as its context. */
export function buildAnswerSignal(input: { runId: number; question: string; answer: string }): BuiltSignal {
  const answer = normalize(input.answer);
  if (!answer) return { ok: false, reason: "empty" };
  const findings = refused("", answer);
  if (findings) return { ok: false, reason: "blocked", findings };
  const question = machineText(input.question);
  const questionRefused = question ? refused("", question) !== null : false;
  const context = question && !questionRefused ? capText(question, SIGNAL_TEXT_MAX) : undefined;
  return {
    ok: true,
    dropped: questionRefused ? 1 : 0,
    draft: {
      kind: "answer",
      sourceKey: `run:${input.runId}`,
      trusted: true,
      payload: { text: capText(answer, SIGNAL_TEXT_MAX), ...(context ? { context } : {}) },
      replace: true,
    },
  };
}

// ── Lessons ────────────────────────────────────────────────────────────────────

/** A lesson the Lead suggests in its finish tool. */
export type Lesson = { title: string; body: string; type: MemoryType; evidence: string };

/**
 * The `lessons` property of the Lead's strict finish schema. No `maxItems`: strict tool schemas don't accept it on
 * every provider, so parseLessons enforces the limit.
 */
export const LESSONS_SCHEMA = {
  type: "array",
  description: `At most ${LESSONS_MAX} lessons from this run for the next agent. Usually empty.`,
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "The lesson in one line." },
      body: { type: "string", description: "A few sentences: what to do or avoid in this repository. No code listings, no secrets." },
      type: { type: "string", enum: [...MEMORY_TYPES] },
      evidence: { type: "string", description: "What happened in this run that supports it." },
    },
    required: ["title", "body", "type", "evidence"],
    additionalProperties: false,
  },
};

/** A title as its dedupe key: case, accents, punctuation and spacing don't make a different lesson. */
export function normalizeTitle(title: string) {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words || squash(title);
}

/**
 * The lessons of a finish call, which is the model's output and may be anything: items without a title and a body are
 * left out, an unknown type reads as "lesson", a repeated title counts once and only the first LESSONS_MAX are kept.
 * Never throws; anything that isn't a list is no lessons.
 */
export function parseLessons(raw: unknown): Lesson[] {
  if (!Array.isArray(raw)) return [];
  const lessons: Lesson[] = [];
  const titles = new Set<string>();
  for (const item of raw) {
    if (lessons.length === LESSONS_MAX) break;
    if (typeof item !== "object" || item === null) continue;
    const fields = item as Record<string, unknown>;
    const title = normalize(fields.title).replace(/\s+/g, " ");
    const body = normalize(fields.body);
    const key = normalizeTitle(title);
    if (!title || !body || titles.has(key)) continue;
    titles.add(key);
    lessons.push({ title, body, type: isMemoryType(fields.type) ? fields.type : "lesson", evidence: normalize(fields.evidence) });
  }
  return lessons;
}

export function buildLessonSignal(lesson: Lesson): BuiltSignal {
  const { title, body, evidence } = lesson;
  if (!title || !body) return { ok: false, reason: "empty" };
  const findings = refused(title, body) ?? (evidence ? refused("", evidence) : null);
  if (findings) return { ok: false, reason: "blocked", findings };
  const shortTitle = capText(title, LESSON_TITLE_MAX);
  return {
    ok: true,
    dropped: 0,
    draft: {
      kind: "lesson",
      sourceKey: `title:${normalizeTitle(shortTitle)}`,
      trusted: false,
      payload: {
        title: shortTitle,
        text: capText(body, SIGNAL_TEXT_MAX),
        type: lesson.type,
        ...(evidence ? { evidence: capText(evidence, LESSON_EVIDENCE_MAX) } : {}),
      },
      replace: false,
    },
  };
}

/** What the agent log says about the Lead's lessons (counts only, never their content), or null when it had none. */
export function lessonsNote(lessons: readonly Lesson[]) {
  if (!lessons.length) return null;
  const blocked = lessons.filter((lesson) => !buildLessonSignal(lesson).ok).length;
  return `suggested ${lessons.length} lesson${lessons.length === 1 ? "" : "s"}${blocked ? `, ${blocked} blocked by the security scan` : ""}`;
}

// ── Remember this ──────────────────────────────────────────────────────────────

/** The text a "Remember this" dialog starts with, and whether the owner wrote it themselves. */
export type RememberPrefill = { text: string; trusted: boolean };

/** A card's title as the starting text. */
export const cardRememberText = (title: string) => capText(title.trim(), REMEMBER_MAX);

/** An agent log entry as the starting text: how a stage ended, or what a tool call did. */
export function stepRememberText(step: { tool: string; target: string | null; summary: string | null }) {
  const summary = step.summary?.trim() ?? "";
  if (step.tool === "result" || step.tool === "stopped") return capText(summary, REMEMBER_MAX);
  const call = [TOOL_LABEL[step.tool] ?? step.tool, step.target].filter(Boolean).join(" ");
  return capText(summary ? `${call}: ${summary}` : call, REMEMBER_MAX);
}

/**
 * What the owner asks to be remembered. Trusted, unless it is word for word a starting text somebody else wrote (a
 * GitHub issue's title, an agent's log entry): saving that unchanged doesn't make it the owner's words.
 */
export function buildRememberSignal(input: { text: unknown; scope: unknown; prefill: RememberPrefill | null }): BuiltSignal {
  const text = normalize(input.text);
  const errors: Partial<Record<SignalField, string>> = {};
  if (!text) errors.text = "Write what should be remembered.";
  else if (text.length > REMEMBER_MAX) errors.text = `Keep it to ${REMEMBER_MAX} characters (this has ${text.length}).`;
  if (!isSignalScope(input.scope)) errors.scope = "Choose where it applies.";
  if (errors.text || !isSignalScope(input.scope)) return { ok: false, reason: "invalid", errors };
  const findings = refused("", text);
  if (findings) return { ok: false, reason: "blocked", findings };
  const unchanged = input.prefill !== null && !input.prefill.trusted && squash(input.prefill.text) === squash(text);
  return {
    ok: true,
    dropped: 0,
    draft: { kind: "remember", sourceKey: `note:${textKey(squash(text))}`, trusted: !unchanged, payload: { text, scope: input.scope }, replace: true },
  };
}

// ── Rejected pull requests ─────────────────────────────────────────────────────

export type RejectionCandidate = {
  id: number;
  state: string;
  mergedAt: Date | null;
  taskId: number | null;
  followUpTaskId: number | null;
  headBranch: string;
  rejectionPrompt: string | null;
};

/**
 * Whether to ask the owner why a pull request was rejected: it was closed without merging, nobody was asked before, and
 * TechTeam didn't put another pull request in its place (a later one from the same branch, from the same card or from
 * its follow-up card). A rerun that takes over a pull request leaves it open, so it never gets here.
 */
export function shouldAskWhyRejected(pr: RejectionCandidate, others: readonly Pick<RejectionCandidate, "id" | "taskId" | "headBranch">[]) {
  if (pr.state !== "closed" || pr.mergedAt !== null || pr.rejectionPrompt !== null) return false;
  return !others.some(
    (other) =>
      other.id > pr.id &&
      (other.headBranch === pr.headBranch || (other.taskId !== null && (other.taskId === pr.taskId || other.taskId === pr.followUpTaskId)))
  );
}

// ── Retention ──────────────────────────────────────────────────────────────────

/** The signals to delete so at most `max` stay: the oldest already used first, then the oldest. */
export function signalsToPrune(rows: readonly { id: number; createdAt: Date; consumedAt: Date | null }[], max = SIGNALS_PER_WORKSPACE_MAX) {
  const excess = rows.length - max;
  if (excess <= 0) return [];
  return [...rows]
    .sort((a, b) => Number(a.consumedAt === null) - Number(b.consumedAt === null) || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
    .slice(0, excess)
    .map((row) => row.id);
}
