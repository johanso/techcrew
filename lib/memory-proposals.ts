import type { MemoryLoad, MemoryMode, MemoryScope, MemoryType } from "@/lib/memory-config";
import type { SignalKind } from "@/lib/memory-signals";

/**
 * The librarian's vocabulary shared by server and client (docs/brain-plan.md, "How a proposal arrives"): proposals,
 * their limits, when learning runs, how a proposal reaches the memory in each mode, and the state of the librarian's
 * last run. Pure: lib/librarian.ts builds and validates proposals, lib/memory-proposals-store.ts delivers them.
 */

// ── Vocabulary ─────────────────────────────────────────────────────────────────

export const PROPOSAL_KINDS = ["add", "update", "retire"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const isProposalKind = (value: unknown): value is ProposalKind => PROPOSAL_KINDS.includes(value as ProposalKind);

/** `in_pr`: sent to the memory pull request, which then ends it as `merged` or `rejected`. */
export const PROPOSAL_STATUSES = ["pending", "accepted", "in_pr", "merged", "rejected", "superseded"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Where a proposal came from, and the origin its note gets: learned from signals, or built from the repository. */
export const PROPOSAL_ORIGINS = ["agent", "bootstrap"] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

/** The librarian's two jobs: learning from signals, and building a first memory from the repository. */
export const LIBRARIAN_JOBS = ["learn", "bootstrap"] as const;
export type LibrarianJob = (typeof LIBRARIAN_JOBS)[number];

export const LIBRARIAN_TRIGGERS = ["auto", "manual"] as const;
export type LibrarianTrigger = (typeof LIBRARIAN_TRIGGERS)[number];

export const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = { add: "New note", update: "Update", retire: "Retire" };

// ── Limits ─────────────────────────────────────────────────────────────────────

/** Proposals of one learning run. */
export const PROPOSALS_MAX = 5;
/** Notes a bootstrap proposes besides the conventions note. */
export const BOOTSTRAP_NOTES_MAX = 5;
/** While this many proposals wait for the owner, nothing is learned automatically. */
export const PENDING_PROPOSALS_MAX = 20;
/** Signals of one learning run, newest first. */
export const LEARN_SIGNALS_MAX = 40;
/** Unused signals that start an automatic run on their own; one the owner typed is enough. */
export const AUTO_MIN_SIGNALS = 3;
export const RATIONALE_MAX = 600;
export const EVIDENCE_SUMMARY_MAX = 300;

// ── The proposal ───────────────────────────────────────────────────────────────

/** The proposed text of a note: what the owner may edit. */
export type ProposalNote = { title: string; type: MemoryType; load: MemoryLoad; paths: string[]; body: string };

/** The note an update or retire proposal was made about, as it was then. `version` is noteVersion of it. */
export type ProposalTarget = { version: string; note: ProposalNote };

/** What a proposal is based on: a signal (copied, since signals can be deleted) or files of the repository. */
export type ProposalEvidence =
  | { kind: SignalKind; signalId: number; trusted: boolean; summary: string; taskId: number | null; prNumber: number | null }
  | { kind: "repository"; trusted: false; files: string[] };

/** A proposal as the Brain page shows it. */
export type ProposalView = {
  id: number;
  kind: ProposalKind;
  scope: MemoryScope;
  status: "pending" | "in_pr";
  /** Null for retire. */
  note: ProposalNote | null;
  targetKey: string | null;
  /** Update and retire: the note as it is now, or as it was proposed when it can't be found. */
  current: ProposalNote | null;
  /** The note changed (or is gone) since the proposal was made: delivering it will refuse. */
  targetChanged: boolean;
  rationale: string;
  evidence: (ProposalEvidence & { card?: { id: number; key: string } | null; prUrl?: string | null })[];
  untrustedOrigin: boolean;
  origin: ProposalOrigin;
  pullRequest: { number: number; url: string } | null;
  createdAt: Date;
};

// ── Delivery ───────────────────────────────────────────────────────────────────

/**
 * How a proposal reaches the memory in the workspace's current mode: accepted on the page (the owner's notes, and
 * project notes in mode `local`), sent in the memory pull request (project notes in mode `repo`), or not at all while
 * memory is off. Switching mode keeps pending proposals; only what can be done with them changes.
 */
export function deliveryOf(scope: MemoryScope, mode: MemoryMode): "inbox" | "pull_request" | null {
  if (mode === "off") return null;
  return scope === "global" || mode === "local" ? "inbox" : "pull_request";
}

// ── When learning runs ─────────────────────────────────────────────────────────

export type LearnFacts = {
  trigger: LibrarianTrigger;
  mode: MemoryMode;
  autoLearn: boolean;
  /** Signals not used yet, and how many of them the owner typed. */
  unconsumed: number;
  trusted: number;
  /** Proposals waiting for the owner. */
  pending: number;
};

/**
 * Whether a learning run goes ahead. "Learn now" takes any unused signal. An automatic request needs memory on,
 * automatic learning on, enough to learn from (a few signals, or one the owner typed) and room in the inbox.
 */
export function learnDecision(facts: LearnFacts): { run: true } | { run: false; reason: string } {
  const no = (reason: string) => ({ run: false as const, reason });
  if (facts.mode === "off") return no("Memory is off for this project.");
  if (facts.unconsumed < 1) return no("There is nothing new to learn from.");
  if (facts.trigger === "manual") return { run: true };
  if (!facts.autoLearn) return no("Automatic learning is off.");
  if (facts.trusted < 1 && facts.unconsumed < AUTO_MIN_SIGNALS) return no("Not enough new signals yet.");
  if (facts.pending >= PENDING_PROPOSALS_MAX) return no(`${PENDING_PROPOSALS_MAX} or more proposals are already waiting.`);
  return { run: true };
}

/** A run the job runner delivers (event `memory/learn.requested`). */
export type LibrarianRequest = { workspaceId: number; job: LibrarianJob; trigger: LibrarianTrigger };

/** An event's data as a request, or null when it isn't one (anything can post to a local job runner). */
export function parseLibrarianRequest(data: unknown): LibrarianRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const { workspaceId, job, trigger } = data as Record<string, unknown>;
  const knownJob = LIBRARIAN_JOBS.find((candidate) => candidate === job);
  const knownTrigger = LIBRARIAN_TRIGGERS.find((candidate) => candidate === trigger);
  if (typeof workspaceId !== "number" || !Number.isSafeInteger(workspaceId) || workspaceId <= 0 || !knownJob || !knownTrigger) return null;
  return { workspaceId, job: knownJob, trigger: knownTrigger };
}

// ── The librarian's state ──────────────────────────────────────────────────────

/** workspaces.memory_librarian: the run asked for or in progress, or how the last one ended. */
export type LibrarianState = {
  state: "queued" | "running" | "done" | "failed";
  job: LibrarianJob;
  trigger: LibrarianTrigger;
  /** ISO time it entered this state. */
  at: string;
  /** What happened, for the owner. Empty while queued or running. */
  message: string;
  proposals: number;
  /** Model spend of the run in micro-dollars. */
  costMicros: number;
};

// A request the job runner never picks up, or a run cut off when TechTeam stopped, must not look busy forever.
export const QUEUED_STALE_MS = 10 * 60_000;
export const RUNNING_STALE_MS = 15 * 60_000;

/** The state as it should be read now: a queued or running one that is too old reads as failed. */
export function currentLibrarianState(state: LibrarianState | null, now: Date): LibrarianState | null {
  if (!state || (state.state !== "queued" && state.state !== "running")) return state;
  const age = now.getTime() - Date.parse(state.at);
  if (age < (state.state === "queued" ? QUEUED_STALE_MS : RUNNING_STALE_MS)) return state;
  const message =
    state.state === "queued"
      ? "The request was never picked up. Check that the Inngest Dev Server is running, then try again."
      : "The run stopped before finishing, probably because TechTeam was closed. Nothing was used up: try again.";
  return { ...state, state: "failed", message };
}

export const librarianBusy = (state: LibrarianState | null) => state?.state === "queued" || state?.state === "running";
