import type { AgentKey, AgentProvider } from "@/lib/agent-config";
import type { BoardColumnId } from "@/lib/board-config";

/**
 * Agent pipeline vocabulary shared by the server (runtime, persistence) and the client (board, PR page, live process).
 * A run takes a card through six phases: analysis → development → review → approval → testing → merge.
 * In the review phase two agents work in parallel (Reviewer and Security), so a phase is not the same as an agent's
 * stage: `agent_runs.stage` stores the phase, the agent log (`agent_run_steps.stage`) and conversations the agent stage.
 */

export const RUN_STAGES = ["analysis", "development", "review", "approval", "testing", "merge"] as const;
/** A pipeline phase. */
export type RunStage = (typeof RUN_STAGES)[number];

export function isRunStage(value: unknown): value is RunStage {
  return typeof value === "string" && (RUN_STAGES as readonly string[]).includes(value);
}

/** Who works each phase and which board column the card sits in meanwhile. The first agent holds the card. */
export const PHASE_META: Record<RunStage, { label: string; verb: string; column: BoardColumnId; agents: AgentKey[] }> = {
  analysis: { label: "Analysis", verb: "Analyzing", column: "analysis", agents: ["analyst"] },
  development: { label: "Development", verb: "Implementing", column: "in_development", agents: ["developer"] },
  review: { label: "Review", verb: "Reviewing", column: "in_review", agents: ["reviewer", "security"] },
  approval: { label: "Approval", verb: "Approving", column: "in_review", agents: ["lead"] },
  testing: { label: "Testing", verb: "Testing", column: "testing", agents: ["tester"] },
  merge: { label: "Merge", verb: "Merging", column: "testing", agents: [] },
};

/** One agent's tool loop in a run. Every agent has exactly one stage. */
export const AGENT_STAGES = ["analysis", "development", "review", "security", "approval", "testing"] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

export function isAgentStage(value: unknown): value is AgentStage {
  return typeof value === "string" && (AGENT_STAGES as readonly string[]).includes(value);
}

export const STAGE_META: Record<AgentStage, { agent: AgentKey; phase: RunStage; label: string; verb: string }> = {
  analysis: { agent: "analyst", phase: "analysis", label: "Analysis", verb: "Analyzing" },
  development: { agent: "developer", phase: "development", label: "Development", verb: "Implementing" },
  review: { agent: "reviewer", phase: "review", label: "Code review", verb: "Reviewing" },
  security: { agent: "security", phase: "review", label: "Security review", verb: "Scanning" },
  approval: { agent: "lead", phase: "approval", label: "Approval", verb: "Approving" },
  testing: { agent: "tester", phase: "testing", label: "Testing", verb: "Testing" },
};

/** The stage an agent works in. */
export const AGENT_STAGE: Record<AgentKey, AgentStage> = {
  analyst: "analysis",
  developer: "development",
  reviewer: "review",
  security: "security",
  lead: "approval",
  tester: "testing",
};

/** Agents still working in `phase`: its agents minus those whose stage already ended (result or stop) this round. */
export function workingAgents(phase: RunStage, endedStages: readonly AgentStage[]): AgentKey[] {
  return PHASE_META[phase].agents.filter((agent) => !endedStages.includes(AGENT_STAGE[agent]));
}

/** How the agent log names each tool call ("Read src/app.ts", "Edited README.md" …). */
export const TOOL_LABEL: Record<string, string> = {
  list_files: "Listed",
  read_file: "Read",
  search_code: "Searched",
  write_file: "Wrote",
  replace_in_file: "Edited",
  delete_file: "Deleted",
  get_diff: "Checked the diff",
  get_checks: "Checked CI",
  search_skill: "Searched skill",
  read_skill: "Read skill",
};

export const RUN_STATUSES = [
  "queued",
  "running",
  // Approved and tested; the pull request waits for the user to merge it (manual merge, or not low risk).
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

/** Development rounds allowed after the first when the Lead or the tests send the work back. */
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

export const SECURITY_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];
export const SECURITY_CATEGORIES = ["secrets", "injection", "permissions", "dependencies", "other"] as const;
export type SecurityCategory = (typeof SECURITY_CATEGORIES)[number];

export type SecurityFinding = { severity: SecuritySeverity; category: SecurityCategory; path: string; detail: string };

export type SecurityReport = {
  verdict: "pass" | "issues";
  summary: string;
  findings: SecurityFinding[];
};

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type RequiredChange = { source: "reviewer" | "security" | "lead"; path: string; detail: string };

/** The Lead's call after both reviews: approve or rework, and how risky the change is (final, after riskFloor). */
export type LeadDecision = {
  decision: "approve" | "request_changes";
  risk: RiskLevel;
  riskReasons: string[];
  summary: string;
  requiredChanges: RequiredChange[];
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

// ── Risk and merging ───────────────────────────────────────────────────────────

/** What the diff touches, measured on GitHub (not reported by an agent). */
export type DiffFacts = { paths: string[]; changedLines: number };

// Paths whose changes deserve the owner's eyes whatever the agents say.
const SENSITIVE_PATHS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pipfile(\.lock)?|pyproject\.toml|poetry\.lock|go\.(mod|sum)|cargo\.(toml|lock)|gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?)$/i,
    reason: "Changes dependencies.",
  },
  { pattern: /(^|\/)(migrations?|drizzle)\/|\.sql$|(^|\/)schema\.prisma$/i, reason: "Changes the database schema or data." },
  // Whole words in a path ("lib/auth.ts", "(auth)/", "session-cache.ts"), not "author-card.css".
  {
    pattern: /(^|[/._()-])(auth|oauth|login|logout|session|sessions|permissions?|passwords?|tokens?|crypto)([/._()-]|$)/i,
    reason: "Touches authentication or permissions.",
  },
  { pattern: /(^|\/)(\.github\/|\.gitlab-ci|dockerfile|docker-compose|[^/]*\.tf$)/i, reason: "Changes CI or infrastructure." },
];

const BIG_CHANGE_FILES = 10;
const BIG_CHANGE_LINES = 400;

/**
 * The lowest risk a change can have, from facts the Lead can't talk away: the Security report's worst finding and
 * what the diff touches. The Lead may rate higher, never lower.
 */
export function riskFloor(security: SecurityReport | null, diff: DiffFacts | null): { risk: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let risk: RiskLevel = "low";
  const raise = (to: RiskLevel, reason: string) => {
    if (RISK_LEVELS.indexOf(to) > RISK_LEVELS.indexOf(risk)) risk = to;
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  const severities = new Set(security?.findings.map((f) => f.severity));
  if (severities.has("critical") || severities.has("high")) raise("high", "Security reported a critical or high finding.");
  else if (severities.has("medium")) raise("medium", "Security reported a medium finding.");

  if (diff) {
    for (const { pattern, reason } of SENSITIVE_PATHS) {
      if (diff.paths.some((path) => pattern.test(path))) raise("medium", reason);
    }
    if (diff.paths.length > BIG_CHANGE_FILES || diff.changedLines > BIG_CHANGE_LINES) {
      raise("medium", `Large change: ${diff.paths.length} files, ${diff.changedLines} lines.`);
    }
  }
  return { risk, reasons };
}

/** The Lead's decision with its risk raised to the floor (reasons merged, the floor's first). */
export function applyRiskFloor(decision: LeadDecision, floor: { risk: RiskLevel; reasons: string[] }): LeadDecision {
  const higher = RISK_LEVELS.indexOf(floor.risk) > RISK_LEVELS.indexOf(decision.risk);
  const reasons = higher ? [...floor.reasons, ...decision.riskReasons] : [...decision.riskReasons, ...floor.reasons];
  return { ...decision, risk: higher ? floor.risk : decision.risk, riskReasons: [...new Set(reasons)] };
}

/** Settings → Agents → Merging. Stored as text in `workspaces.agent_merge_mode`. */
export const MERGE_MODES = ["manual", "auto_low_risk", "auto"] as const;
export type MergeMode = (typeof MERGE_MODES)[number];

export function isMergeMode(value: unknown): value is MergeMode {
  return typeof value === "string" && (MERGE_MODES as readonly string[]).includes(value);
}

/** A stored merge mode; anything unknown merges manually (the safe choice). */
export function parseMergeMode(value: unknown): MergeMode {
  return isMergeMode(value) ? value : "manual";
}

/** Whether an approved, tested pull request merges on its own or waits for the owner. */
export function mergeDecision(mode: MergeMode, risk: RiskLevel): "auto" | "wait" {
  if (mode === "auto") return "auto";
  if (mode === "auto_low_risk" && risk === "low") return "auto";
  return "wait";
}
