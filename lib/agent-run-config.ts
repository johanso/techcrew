import type { AgentKey, AgentProvider } from "@/lib/agent-config";
import type { BoardColumnId } from "@/lib/board-config";

/**
 * Agent pipeline vocabulary shared by the server (runtime, persistence) and the client (board, PR page).
 * A run takes a card through: analysis → development → review → testing → merge.
 */

export const RUN_STAGES = ["analysis", "development", "review", "testing", "merge"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/** Who works each stage and which board column the card sits in meanwhile. */
export const STAGE_META: Record<RunStage, { agent: AgentKey | null; column: BoardColumnId; verb: string }> = {
  analysis: { agent: "analyst", column: "analysis", verb: "Analyzing" },
  development: { agent: "developer", column: "in_development", verb: "Implementing" },
  review: { agent: "reviewer", column: "in_review", verb: "Reviewing" },
  testing: { agent: "tester", column: "testing", verb: "Testing" },
  merge: { agent: null, column: "testing", verb: "Merging" },
};

export const RUN_STATUSES = [
  "queued",
  "running",
  // Review and tests passed; the pull request waits for the user to merge it (manual merge).
  "awaiting_merge",
  "completed",
  // The analyst needs a human answer before work can start.
  "needs_info",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Runs still moving on their own. A card with one of these can't be run again. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["queued", "running"];

export function isActiveRun(status: RunStatus) {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/** Development rounds allowed after the first when review or tests send the work back. */
export const MAX_REWORK_ROUNDS = 2;

export const MAX_TURNS_MIN = 3;
export const MAX_TURNS_MAX = 100;

/** Longest answer to the analyst's question; it goes into every later agent prompt for the card. */
export const ANSWER_MAX = 2000;

/** Validates an answer to the analyst's question (server action input). */
export function parseAnswer(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Write an answer for the analyst." };
  if (value.length > ANSWER_MAX) return { ok: false, error: `Keep the answer under ${ANSWER_MAX} characters.` };
  return { ok: true, value };
}

// ── Stage results (stored as jsonb on agent_runs) ──────────────────────────────

export type AnalystBrief = {
  decision: "ready" | "needs_info";
  summary: string;
  acceptanceCriteria: string[];
  plan: string[];
  relevantFiles: string[];
  /** Extra guidance for the developer. */
  developerNotes: string;
  /** What the analyst needs answered (decision = needs_info). */
  question: string;
};

export type ReviewFinding = { severity: "blocker" | "major" | "minor"; path: string; detail: string };

export type ReviewReport = {
  verdict: "approve" | "request_changes";
  summary: string;
  findings: ReviewFinding[];
};

export type TestCheck = { name: string; passed: boolean; detail: string };

export type TestReport = {
  verdict: "pass" | "fail";
  summary: string;
  checks: TestCheck[];
};

/** Why a run stopped, as data the UI can act on (alongside the `error` text). */
export type RunFailure = { kind: "out_of_credit"; provider: AgentProvider };

/** What a board card shows about its latest run. */
export type BoardCardRun = {
  id: number;
  status: RunStatus;
  stage: RunStage | null;
  error: string | null;
  failure: RunFailure | null;
  pullRequest: { number: number; url: string } | null;
};
