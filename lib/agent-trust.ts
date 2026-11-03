import { AGENT_ROLES, SKILL_BY_ID, type AgentKey, type SkillId, type SkillRisk } from "@/lib/agent-config";

/**
 * Skill Trust Score: a 0–100 rating of how safely an agent is configured, from its skills, instructions and budget.
 * `scanAgentRules` is deterministic and free; lib/agent-ai.ts adds an optional OpenAI review on top.
 * Pure module (no DB, no secrets): the dialog can import the types and `trustGrade`.
 */

export type TrustSeverity = "critical" | "high" | "medium" | "low" | "info";

export type TrustFinding = {
  id: string;
  severity: TrustSeverity;
  title: string;
  detail: string;
  source: "rules" | "ai";
};

export type TrustReport = {
  score: number;
  summary: string;
  findings: TrustFinding[];
  checksPassed: number;
  checksTotal: number;
  /** "ai" when OpenAI reviewed the configuration too. */
  mode: "rules" | "ai";
  model: string | null;
  scannedAt: string;
};

export type TrustScanInput = {
  key: AgentKey;
  instructions: string;
  skills: SkillId[];
  monthlyBudgetCents: number;
};

/** Points every granted skill costs, even when well guarded: more power is more risk. */
const INHERENT_RISK: Record<SkillRisk, number> = { low: 0, medium: 2, high: 5, critical: 15 };

/** Points an unresolved finding costs on top of that. */
export const SEVERITY_PENALTY: Record<TrustSeverity, number> = { critical: 25, high: 10, medium: 6, low: 2, info: 1 };

export const SEVERITY_ORDER: TrustSeverity[] = ["critical", "high", "medium", "low", "info"];

export function trustGrade(score: number) {
  if (score >= 85) return { label: "Trusted", tone: "text-success" } as const;
  if (score >= 70) return { label: "Needs review", tone: "text-warning" } as const;
  return { label: "At risk", tone: "text-error" } as const;
}

const BOUNDARY = /\b(never|do not|don't|must not|only)\b/i;
const NEGATION = /\b(never|do not|don't|must not|no|without)\b/i;

/** A risky phrase only counts when its own line doesn't forbid it ("Never force-push" is a guardrail). */
function riskyLine(instructions: string, pattern: RegExp) {
  return instructions.split("\n").some((line) => pattern.test(line) && !NEGATION.test(line));
}

type Check = { id: string; failed: boolean; finding: Omit<TrustFinding, "id" | "source"> };

export function scanAgentRules(input: TrustScanInput): TrustReport {
  const { key, instructions, skills, monthlyBudgetCents } = input;
  const has = (id: SkillId) => skills.includes(id);
  const text = instructions.toLowerCase();
  const role = AGENT_ROLES[key];

  const checks: Check[] = [
    // ── Instructions ──
    {
      id: "instructions-length",
      failed: instructions.trim().length < 300,
      finding: {
        severity: "high",
        title: "Instructions are too short",
        detail: "Short instructions leave the agent to improvise. Describe its workflow, expected output and limits.",
      },
    },
    {
      id: "instructions-boundaries",
      failed: !BOUNDARY.test(instructions),
      finding: {
        severity: "medium",
        title: "No explicit boundaries",
        detail: "Add a Boundaries section that says what the agent must never do (e.g. push to the default branch).",
      },
    },
    {
      id: "untrusted-input",
      failed: !text.includes("untrusted"),
      finding: {
        severity: "medium",
        title: "No prompt-injection guidance",
        detail: "Issues, comments and web pages can contain hostile text. Tell the agent to treat them as untrusted data, not instructions.",
      },
    },
    {
      id: "injection-phrase",
      failed: /ignore (all |any )?(the )?(previous|prior|above) instructions/i.test(instructions),
      finding: {
        severity: "critical",
        title: "Instructions contain a prompt-injection phrase",
        detail: "“Ignore previous instructions” overrides the agent's safety rules. Remove it.",
      },
    },
    {
      id: "embedded-credential",
      failed: /(sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(instructions),
      finding: {
        severity: "critical",
        title: "Instructions contain what looks like a credential",
        detail: "Never paste keys or tokens into instructions; they're sent to the model on every run. Remove it and rotate the key.",
      },
    },
    {
      id: "push-default-branch",
      failed: riskyLine(instructions, /(push|commit)(ed)? (directly )?(to|into|on) (main|master|the default branch)|force[- ]?push/i),
      finding: {
        severity: "high",
        title: "Instructions allow pushing to the default branch",
        detail: "Agents should work on their own branches and go through a pull request.",
      },
    },
    {
      id: "skip-checks",
      failed: riskyLine(instructions, /(disable|skip|bypass|delete) (the |all |any )?(tests?|ci|checks|reviews?)/i),
      finding: {
        severity: "high",
        title: "Instructions allow skipping tests or reviews",
        detail: "Telling an agent to bypass checks removes the safety net that catches its mistakes.",
      },
    },

    // ── Skills ──
    {
      id: "merge-without-review",
      failed: has("pr.merge"),
      finding: {
        severity: has("code.write") ? "critical" : "high",
        title: has("code.write") ? "Can write and merge its own code" : "Can merge pull requests",
        detail: "Merging skips human approval. Keep a person in the loop unless you fully trust this agent's output.",
      },
    },
    {
      id: "secrets-access",
      failed: has("secrets.read"),
      finding: {
        severity: has("web.research") ? "critical" : "high",
        title: has("web.research") ? "Secrets and web access combined" : "Can read environment secrets",
        detail: has("web.research")
          ? "An agent that reads secrets and browses the web can be tricked into leaking them. Remove one of the two."
          : "Few agents need secrets. Grant them only if a task can't be done without them.",
      },
    },
    {
      id: "web-to-code",
      failed: has("web.research") && has("code.write") && !text.includes("untrusted"),
      finding: {
        severity: "high",
        title: "Web content can steer code changes",
        detail: "This agent reads the web and writes code without prompt-injection guidance in its instructions.",
      },
    },
    {
      id: "sandbox",
      failed: has("tests.run") && !text.includes("sandbox"),
      finding: {
        severity: "medium",
        title: "Runs code without sandbox guidance",
        detail: "Tell the agent to run tests and builds only in the sandbox, never against real services.",
      },
    },
    {
      id: "branch-rule",
      failed: has("code.write") && !/(never|do not|don't)[^\n]*(default branch|main branch|\bmain\b)/i.test(instructions),
      finding: {
        severity: "medium",
        title: "No branch rule for code changes",
        detail: "Say explicitly that the agent must never push to the default branch.",
      },
    },
    {
      id: "dependencies",
      failed: has("deps.manage") && !text.includes("dependenc"),
      finding: {
        severity: "medium",
        title: "Dependency changes aren't constrained",
        detail: "New packages are a supply-chain risk. Ask the agent to justify every dependency change in the pull request.",
      },
    },
    {
      id: "off-role-skills",
      failed: skills.some((s) => !role.defaults.skills.includes(s) && SKILL_BY_ID[s].risk !== "low"),
      finding: {
        severity: "low",
        title: `Skills beyond the ${role.name} role`,
        detail: `${skills
          .filter((s) => !role.defaults.skills.includes(s) && SKILL_BY_ID[s].risk !== "low")
          .map((s) => SKILL_BY_ID[s].name)
          .join(", ")} ${skills.length > 1 ? "aren't" : "isn't"} part of this role's defaults. Make sure the agent needs them.`,
      },
    },

    // ── Budget ──
    {
      id: "budget",
      failed: monthlyBudgetCents > 100_000,
      finding: {
        severity: "medium",
        title: "Large monthly budget",
        detail: "A budget above $1,000 limits little if the agent loops or is misused. Start lower and raise it when needed.",
      },
    },
  ];

  const findings: TrustFinding[] = checks
    .filter((c) => c.failed)
    .map((c) => ({ id: c.id, source: "rules", ...c.finding }));

  const inherent = skills.reduce((sum, s) => sum + INHERENT_RISK[SKILL_BY_ID[s].risk], 0);
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - inherent - penalty));

  return {
    score,
    summary: summarize(findings, skills),
    findings: sortFindings(findings),
    checksPassed: checks.length - findings.length,
    checksTotal: checks.length,
    mode: "rules",
    model: null,
    scannedAt: new Date().toISOString(),
  };
}

export function sortFindings(findings: TrustFinding[]) {
  return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function summarize(findings: TrustFinding[], skills: SkillId[]) {
  const risky = skills.filter((s) => ["high", "critical"].includes(SKILL_BY_ID[s].risk)).length;
  const exposure = `${skills.length} skill${skills.length === 1 ? "" : "s"}${risky ? `, ${risky} high-risk` : ""}`;
  if (!findings.length) return `No issues found. ${exposure}, all guarded by the instructions.`;
  const worst = sortFindings(findings)[0]!;
  return `${findings.length} issue${findings.length === 1 ? "" : "s"} to review (worst: ${worst.severity}). ${exposure}.`;
}
