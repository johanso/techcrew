import { sortFindings, type TrustFinding, type TrustReport, type TrustSeverity } from "@/lib/agent-trust";

/**
 * Switch Trust vocabulary shared by server and client: scan statuses, the API shapes we read, and the pure
 * mapping from an evaluation run to a TrustReport. No server imports, so it can be unit tested.
 */

export const DEFAULT_SWITCH_INSTANCE = "https://api.switchagents.ai";

export const TRUST_SCAN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type TrustScanStatus = (typeof TRUST_SCAN_STATUSES)[number];

export const TRUST_SCAN_TRIGGERS = ["connected", "manual"] as const;
export type TrustScanTrigger = (typeof TRUST_SCAN_TRIGGERS)[number];

export const isPendingScan = (status: string) => status === "queued" || status === "running";

/** What the AI Team page shows about an agent's latest SwitchAgent scan. */
export type TrustScanView = {
  id: number;
  status: TrustScanStatus;
  trigger: TrustScanTrigger;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/**
 * The API base for an instance URL the user typed: "api.switchagents.ai", "https://api.switchagents.ai" and
 * ".../api/v1" all become "https://api.switchagents.ai/api/v1". Only https, no credentials, query or fragment.
 */
export function normalizeInstanceUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const text = raw.trim() || DEFAULT_SWITCH_INSTANCE;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "Enter the instance URL, e.g. https://api.switchagents.ai." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The instance URL must start with https://." };
  if (url.username || url.password || url.search || url.hash) return { ok: false, error: "Enter only the instance address." };
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return { ok: true, value: `${url.origin}${path}/api/v1` };
}

/** "sk_live_abc…wxyz" → "sk_live_••••wxyz". */
export function maskSwitchKey(key: string) {
  const prefix = key.match(/^[a-z]+_(live_|test_)?/i)?.[0] ?? "";
  return `${prefix}••••${key.slice(-4)}`;
}

// ── API shapes (only the fields we read) ───────────────────────────────────────

export type SwitchEvaluation = { id: string; name: string; approach?: string; is_builtin?: boolean; num_prompts?: number };

export type SwitchRun = {
  id: string;
  status?: string;
  error_kind?: string;
  error_message?: string;
  summary?: Record<string, unknown> | null;
};

export type SwitchRunResult = { status?: string; score?: number | null };

export type SwitchSummary = {
  health?: { score?: number | null; previous_score?: number | null } | null;
  coverage?: { code?: string; at_risk?: number; passing?: number; not_run?: number; total?: number }[] | null;
};

/**
 * The evaluation every agent runs: one, and the quickest to finish. Built-in ones first (they need no setup),
 * then single-turn probes over multi-turn adversarial attacks, then the fewest prompts.
 */
export function pickFastEvaluation(items: SwitchEvaluation[]): SwitchEvaluation | null {
  const multiTurn = (e: SwitchEvaluation) => /adversarial|multi[- ]?turn|crescendo|jailbreak/i.test(e.name);
  const prompts = (e: SwitchEvaluation) => (e.num_prompts && e.num_prompts > 0 ? e.num_prompts : Number.MAX_SAFE_INTEGER);
  const ranked = [...items].sort(
    (a, b) =>
      Number(!a.is_builtin) - Number(!b.is_builtin) ||
      Number(multiTurn(a)) - Number(multiTurn(b)) ||
      prompts(a) - prompts(b) ||
      a.name.localeCompare(b.name)
  );
  return ranked[0] ?? null;
}

/** Where a Switch evaluation run is. Statuses are read loosely: the API documents Queued, Running, Done, Failed. */
export function runPhase(status: string | undefined): "pending" | "done" | "failed" {
  const s = (status ?? "").toLowerCase();
  if (["done", "completed", "complete", "succeeded", "success", "finished", "scored"].includes(s)) return "done";
  if (["failed", "error", "errored", "cancelled", "canceled", "timeout", "timed_out"].includes(s)) return "failed";
  return "pending";
}

/** Error kinds from Switch (model_errors.py) in words for the owner. */
const RUN_ERRORS: Record<string, string> = {
  auth_failed: "Switch couldn't sign in to the agent's endpoint.",
  unreachable: "Switch couldn't reach the agent. The app's public URL must be reachable from the internet.",
  quota_exceeded: "The agent's AI provider ran out of quota during the evaluation.",
  timeout: "The agent took too long to answer Switch's tests.",
  blocked: "The evaluation was blocked.",
  invalid_config: "Switch rejected the agent's endpoint configuration.",
  plan_limit_exceeded: "Your Switch plan's evaluation limit is reached.",
};

export function runErrorMessage(run: SwitchRun) {
  const known = run.error_kind ? RUN_ERRORS[run.error_kind] : undefined;
  return known ?? (run.error_message ? `Switch: ${run.error_message.slice(0, 200)}` : "The Switch evaluation failed.");
}

/** Scores arrive as 0–1 or 0–100; the app shows 0–100. */
export function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

const passed = (r: SwitchRunResult) => /^(pass|passed|ok|held|success)$/i.test(r.status ?? "");
const failed = (r: SwitchRunResult) => /^(fail|failed|compromised)$/i.test(r.status ?? "");

/** OWASP risks covered: passing over evaluated (risks the evaluation didn't run don't count). */
export function coveragePercent(summary: SwitchSummary): number | null {
  const items = summary.coverage ?? [];
  const evaluated = items.reduce((sum, c) => sum + Math.max(0, (c.total ?? 0) - (c.not_run ?? 0)), 0);
  if (!evaluated) return null;
  return Math.round((items.reduce((sum, c) => sum + (c.passing ?? 0), 0) / evaluated) * 100);
}

/**
 * The report saved on the agent after a run: Switch's health score, the run's pass rate as checks, one finding
 * for compromised tests and one per OWASP risk Switch marks at risk. Conversation text is never copied: it's
 * attacker-written and can contain anything.
 */
export function buildSwitchReport(input: {
  evaluation: string;
  run: SwitchRun;
  results: SwitchRunResult[];
  summary: SwitchSummary;
  scannedAt: Date;
}): TrustReport {
  const { results, summary } = input;
  const total = results.length;
  const held = results.filter(passed).length;
  const broke = results.filter(failed).length;
  const runScore = normalizeScore(input.run.summary?.score) ?? normalizeScore(input.run.summary?.overall_score);
  const score = normalizeScore(summary.health?.score) ?? runScore ?? (total ? Math.round((held / total) * 100) : 0);
  const coverage = coveragePercent(summary);

  const findings: TrustFinding[] = [];
  if (broke) {
    const share = broke / Math.max(total, 1);
    const severity: TrustSeverity = share >= 0.5 ? "critical" : share >= 0.25 ? "high" : share >= 0.1 ? "medium" : "low";
    findings.push({
      id: "switch-compromised",
      source: "switch",
      severity,
      title: `${broke} of ${total} attacks compromised the agent`,
      detail: "Open the run in Switch Trust to read each conversation, then tighten the agent's instructions and boundaries.",
    });
  }
  for (const risk of summary.coverage ?? []) {
    if (!risk.code || !risk.at_risk) continue;
    findings.push({
      id: `switch-${risk.code.toLowerCase()}`,
      source: "switch",
      severity: "high",
      title: `${risk.code} at risk`,
      detail: `An evaluation mapped to ${risk.code} scored below 80% on its last run.`,
    });
  }

  const pieces = [
    total ? `${held} of ${total} tests held` : "Evaluation finished",
    coverage !== null ? `OWASP coverage ${coverage}%` : null,
  ].filter(Boolean);
  return {
    score,
    summary: `${input.evaluation}: ${pieces.join(", ")}.`,
    findings: sortFindings(findings),
    checksPassed: held,
    checksTotal: total,
    mode: "switch",
    model: null,
    scannedAt: input.scannedAt.toISOString(),
    evaluation: input.evaluation,
    coverage,
  };
}

// ── Evaluation endpoint ────────────────────────────────────────────────────────

export type EvalMessage = { role: "user" | "assistant"; content: string };

const EVAL_MESSAGES_MAX = 24;
const EVAL_MESSAGE_CHARS = 8_000;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("\n");
}

/**
 * The conversation from an OpenAI-style chat request Switch sends to an agent: user and assistant turns only (the
 * agent's own instructions are the system prompt, so a test can't replace them), alternating, starting with the
 * user, capped in count and length. Null when there is nothing to answer.
 */
export function parseEvalMessages(body: unknown): EvalMessage[] | null {
  const raw = typeof body === "object" && body !== null ? (body as { messages?: unknown }).messages : null;
  if (!Array.isArray(raw)) return null;
  const messages: EvalMessage[] = [];
  for (const item of raw.slice(-EVAL_MESSAGES_MAX)) {
    if (typeof item !== "object" || item === null) continue;
    const role = (item as { role?: unknown }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = messageText((item as { content?: unknown }).content).trim().slice(0, EVAL_MESSAGE_CHARS);
    if (!content) continue;
    const last = messages.at(-1);
    if (last?.role === role) last.content = `${last.content}\n\n${content}`.slice(0, EVAL_MESSAGE_CHARS);
    else messages.push({ role, content });
  }
  while (messages[0]?.role === "assistant") messages.shift();
  // The agent answers the last user turn; a trailing assistant turn would be read as a prefill.
  while (messages.at(-1)?.role === "assistant") messages.pop();
  return messages.some((m) => m.role === "user") ? messages : null;
}

/** Whether SwitchAgent scans are available on the AI Team page, and if not, why (server setup). */
export type SwitchTrustStatus = { connected: boolean; problem: string | null };
