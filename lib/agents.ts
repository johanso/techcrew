import "server-only";

import { and, desc, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { agentActivity, agents, db, tasks, type AgentRow, type Workspace } from "@/db";
import {
  AGENT_KEYS,
  AGENT_MODELS,
  AGENT_ROLES,
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  DESCRIPTION_MAX,
  INSTRUCTIONS_MAX,
  INSTRUCTIONS_MIN,
  SKILL_BY_ID,
  formatCents,
  isAgentKey,
  isAgentModelId,
  isSkillId,
  type Agent,
  type AgentKey,
  type AgentModelId,
  type AgentTone,
  type SkillId,
} from "@/lib/agent-config";
import { scanAgentRules, type TrustReport } from "@/lib/agent-trust";

/**
 * AI agents of a workspace: the four roles from lib/agent-config.ts, persisted in `agents` and created on first use.
 * Every function takes a workspace the caller has already authorized and scopes its queries to it.
 */

export type { Agent, AgentTone };
export type AgentId = AgentKey;

/** The agent that picks up a card when it is run from the board. */
export const RUN_AGENT_ID: AgentKey = "analyst";

/** Identity for an assignee id stored on a card (name, role, tone are fixed per role). */
export function getAgent(id: string | null): Agent | null {
  if (!isAgentKey(id)) return null;
  const { defaults: _defaults, ...agent } = AGENT_ROLES[id];
  return agent;
}

/** Short uppercase prefix for task keys, e.g. "Acme Platform" → "ACM". */
export function taskKeyPrefix(workspaceName: string) {
  return workspaceName.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "TSK";
}

// ── Activity ───────────────────────────────────────────────────────────────────

export const AGENT_ACTIVITY_KINDS = [
  "joined",
  "configured",
  "paused",
  "resumed",
  "generated",
  "scan",
  "task_assigned",
  // Reserved for the agent runtime: model spend while working on a card.
  "task_run",
] as const;
export type AgentActivityKind = (typeof AGENT_ACTIVITY_KINDS)[number];

/** How spend is grouped in the configure dialog. */
export type SpendCategory = "tasks" | "configuration" | "scans";
const SPEND_CATEGORY: Partial<Record<AgentActivityKind, SpendCategory>> = {
  task_run: "tasks",
  generated: "configuration",
  scan: "scans",
};

export async function logAgentActivity(values: {
  workspaceId: number;
  agentId: number;
  kind: AgentActivityKind;
  title: string;
  detail?: string | null;
  costMicros?: number;
  taskId?: number | null;
}) {
  await db.insert(agentActivity).values({ ...values, costMicros: values.costMicros ?? 0 });
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/**
 * Creates any of the four default agents this workspace doesn't have yet, each with a first (rule-based) trust
 * scan. Safe to call on every request: concurrent calls can't duplicate thanks to (workspace_id, key).
 */
export async function ensureDefaultAgents(workspaceId: number) {
  const existing = await db.select({ key: agents.key }).from(agents).where(eq(agents.workspaceId, workspaceId));
  const missing = AGENT_KEYS.filter((key) => !existing.some((row) => row.key === key));
  if (!missing.length) return;

  const now = new Date();
  const inserted = await db
    .insert(agents)
    .values(
      missing.map((key) => {
        const { defaults } = AGENT_ROLES[key];
        const monthlyBudgetCents = defaults.monthlyBudgetUsd * 100;
        const report = scanAgentRules({ key, instructions: defaults.instructions, skills: defaults.skills, monthlyBudgetCents });
        return {
          workspaceId,
          key,
          description: defaults.description,
          instructions: defaults.instructions,
          model: defaults.model,
          skills: defaults.skills,
          monthlyBudgetCents,
          trustScore: report.score,
          trustReport: report,
          trustScannedAt: now,
        };
      })
    )
    .onConflictDoNothing({ target: [agents.workspaceId, agents.key] })
    .returning();

  if (inserted.length) {
    await db.insert(agentActivity).values(
      inserted.flatMap((row) => [
        { workspaceId, agentId: row.id, kind: "joined", title: "Joined the team", detail: "Created with the default configuration.", createdAt: now },
        {
          workspaceId,
          agentId: row.id,
          kind: "scan",
          title: `Trust scan: ${row.trustScore}/100`,
          detail: row.trustReport?.summary ?? null,
          // A millisecond later, so it lists above "Joined the team".
          createdAt: new Date(now.getTime() + 1),
        },
      ])
    );
  }
}

export async function getAgentRow(workspaceId: number, key: AgentKey) {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.key, key)));
  return row ?? null;
}

// ── Month window ───────────────────────────────────────────────────────────────

/** Calendar month in UTC: spend and budgets reset on the 1st. */
function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

async function monthSpendMicros(agentId: number) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${agentActivity.costMicros}), 0)::int` })
    .from(agentActivity)
    .where(and(eq(agentActivity.agentId, agentId), gte(agentActivity.createdAt, monthWindow().start)));
  return row?.total ?? 0;
}

// ── Page data ──────────────────────────────────────────────────────────────────

export type AgentStatus = "ready" | "working" | "paused" | "over_budget";

export type AgentActivityView = {
  id: number;
  kind: AgentActivityKind;
  title: string;
  detail: string | null;
  costMicros: number;
  at: string;
};

export type AgentView = Agent & {
  description: string;
  instructions: string;
  model: AgentModelId;
  skills: SkillId[];
  monthlyBudgetCents: number;
  enabled: boolean;
  status: AgentStatus;
  /** Cards assigned to this agent that aren't Done. */
  openTasks: number;
  spend: {
    monthMicros: number;
    byCategory: Record<SpendCategory, number>;
    /** Linear projection of this month's spend to month end. */
    projectedMicros: number;
    resetsAt: string;
  };
  trust: TrustReport | null;
  activity: AgentActivityView[];
};

export type AgentTeamStats = {
  total: number;
  active: number;
  working: number;
  trustAverage: number | null;
  lowestTrust: { name: string; score: number } | null;
  monthSpendMicros: number;
  monthBudgetCents: number;
};

const ACTIVITY_PER_AGENT = 50;

/** Everything the AI Team page shows. Creates the default agents on first visit. */
export async function getAgentTeam(workspace: Pick<Workspace, "id">): Promise<{ agents: AgentView[]; stats: AgentTeamStats }> {
  await ensureDefaultAgents(workspace.id);
  const { start, end } = monthWindow();

  const [rows, spendRows, taskRows, activityRows] = await Promise.all([
    db.select().from(agents).where(eq(agents.workspaceId, workspace.id)),
    db
      .select({
        agentId: agentActivity.agentId,
        kind: agentActivity.kind,
        total: sql<number>`sum(${agentActivity.costMicros})::int`,
      })
      .from(agentActivity)
      .where(and(eq(agentActivity.workspaceId, workspace.id), gte(agentActivity.createdAt, start)))
      .groupBy(agentActivity.agentId, agentActivity.kind),
    db
      .select({ key: tasks.assigneeAgentId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, workspace.id), isNull(tasks.removedAt), isNotNull(tasks.assigneeAgentId), ne(tasks.status, "done"))
      )
      .groupBy(tasks.assigneeAgentId),
    db
      .select()
      .from(agentActivity)
      .where(eq(agentActivity.workspaceId, workspace.id))
      .orderBy(desc(agentActivity.createdAt), desc(agentActivity.id))
      .limit(ACTIVITY_PER_AGENT * AGENT_KEYS.length),
  ]);

  const now = Date.now();
  const elapsedDays = Math.max(1, (now - start.getTime()) / 86_400_000);
  const monthDays = (end.getTime() - start.getTime()) / 86_400_000;

  const views = AGENT_KEYS.flatMap((key): AgentView[] => {
    const row = rows.find((r) => r.key === key);
    if (!row) return [];
    const byCategory: Record<SpendCategory, number> = { tasks: 0, configuration: 0, scans: 0 };
    let monthMicros = 0;
    for (const s of spendRows.filter((s) => s.agentId === row.id)) {
      monthMicros += s.total;
      const category = SPEND_CATEGORY[s.kind as AgentActivityKind];
      if (category) byCategory[category] += s.total;
    }
    const openTasks = taskRows.find((t) => t.key === key)?.count ?? 0;
    const overBudget = monthMicros >= row.monthlyBudgetCents * 10_000;

    return [
      {
        ...getAgent(key)!,
        description: row.description,
        instructions: row.instructions,
        model: isAgentModelId(row.model) ? row.model : AGENT_ROLES[key].defaults.model,
        skills: row.skills.filter(isSkillId),
        monthlyBudgetCents: row.monthlyBudgetCents,
        enabled: row.enabled,
        status: !row.enabled ? "paused" : overBudget ? "over_budget" : openTasks > 0 ? "working" : "ready",
        openTasks,
        spend: {
          monthMicros,
          byCategory,
          projectedMicros: Math.round((monthMicros / elapsedDays) * monthDays),
          resetsAt: end.toISOString(),
        },
        trust: row.trustReport ?? null,
        activity: activityRows
          .filter((a) => a.agentId === row.id)
          .slice(0, ACTIVITY_PER_AGENT)
          .map((a) => ({
            id: a.id,
            kind: a.kind as AgentActivityKind,
            title: a.title,
            detail: a.detail,
            costMicros: a.costMicros,
            at: a.createdAt.toISOString(),
          })),
      },
    ];
  });

  const scored = views.filter((v) => v.trust);
  const lowest = scored.reduce<AgentView | null>((low, v) => (!low || v.trust!.score < low.trust!.score ? v : low), null);

  return {
    agents: views,
    stats: {
      total: views.length,
      active: views.filter((v) => v.enabled).length,
      working: views.filter((v) => v.status === "working").length,
      trustAverage: scored.length ? Math.round(scored.reduce((sum, v) => sum + v.trust!.score, 0) / scored.length) : null,
      lowestTrust: lowest ? { name: lowest.name, score: lowest.trust!.score } : null,
      monthSpendMicros: views.reduce((sum, v) => sum + v.spend.monthMicros, 0),
      monthBudgetCents: views.reduce((sum, v) => sum + v.monthlyBudgetCents, 0),
    },
  };
}

// ── Configuration ──────────────────────────────────────────────────────────────

export type AgentConfigInput = {
  description: string;
  instructions: string;
  model: AgentModelId;
  skills: SkillId[];
  monthlyBudgetCents: number;
  enabled: boolean;
};

export type AgentConfigField = "description" | "instructions" | "model" | "skills" | "budget";

export type ParseResult =
  | { ok: true; value: AgentConfigInput }
  | { ok: false; error: string; errors?: Partial<Record<AgentConfigField, string>> };

/** Validates untrusted input from the configure dialog. */
export function parseAgentConfigInput(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid request." };
  const input = raw as Record<string, unknown>;
  const errors: Partial<Record<AgentConfigField, string>> = {};

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) errors.description = "Describe what this agent does.";
  else if (description.length > DESCRIPTION_MAX) errors.description = `Keep it under ${DESCRIPTION_MAX} characters.`;

  const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (instructions.length < INSTRUCTIONS_MIN) errors.instructions = `Write at least ${INSTRUCTIONS_MIN} characters of instructions.`;
  else if (instructions.length > INSTRUCTIONS_MAX) errors.instructions = `Keep instructions under ${INSTRUCTIONS_MAX.toLocaleString()} characters.`;

  if (!isAgentModelId(input.model)) errors.model = "Choose a model.";

  const skills = Array.isArray(input.skills) ? [...new Set(input.skills.filter(isSkillId))] : [];
  if (!skills.length) errors.skills = "Attach at least one skill.";

  const budget = typeof input.monthlyBudgetUsd === "number" ? input.monthlyBudgetUsd : Number.NaN;
  if (!Number.isFinite(budget) || budget < BUDGET_MIN_USD || budget > BUDGET_MAX_USD) {
    errors.budget = `Set a budget between $${BUDGET_MIN_USD} and $${BUDGET_MAX_USD.toLocaleString()}.`;
  }

  if (Object.keys(errors).length) return { ok: false, error: "Check the highlighted fields.", errors };
  return {
    ok: true,
    value: {
      description,
      instructions,
      model: input.model as AgentModelId,
      skills,
      monthlyBudgetCents: Math.round(budget * 100),
      enabled: input.enabled !== false,
    },
  };
}

function modelLabel(id: string) {
  return AGENT_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** "Instructions, model (GPT-6.1 Sol → GPT-6 Luna), skills (+Web research)" — for the activity log. */
function describeChanges(row: AgentRow, next: AgentConfigInput) {
  const changes: string[] = [];
  if (row.description !== next.description) changes.push("description");
  if (row.instructions !== next.instructions) changes.push("instructions");
  if (row.model !== next.model) changes.push(`model (${modelLabel(row.model)} → ${modelLabel(next.model)})`);
  const added = next.skills.filter((s) => !row.skills.includes(s));
  const removed = row.skills.filter((s) => !next.skills.includes(s as SkillId)) as SkillId[];
  if (added.length || removed.length) {
    const parts = [...added.map((s) => `+${SKILL_BY_ID[s].name}`), ...removed.filter(isSkillId).map((s) => `−${SKILL_BY_ID[s].name}`)];
    changes.push(`skills (${parts.join(", ")})`);
  }
  if (row.monthlyBudgetCents !== next.monthlyBudgetCents) {
    changes.push(`budget (${formatCents(row.monthlyBudgetCents)} → ${formatCents(next.monthlyBudgetCents)})`);
  }
  return changes;
}

/**
 * Saves the dialog's configuration. When anything the trust score depends on changes, the rule scan re-runs so
 * the score never describes a configuration that no longer exists.
 */
export async function updateAgentConfig(workspaceId: number, key: AgentKey, input: AgentConfigInput) {
  const row = await getAgentRow(workspaceId, key);
  if (!row) return null;

  const changes = describeChanges(row, input);
  const trustInputsChanged =
    row.instructions !== input.instructions ||
    row.monthlyBudgetCents !== input.monthlyBudgetCents ||
    row.skills.join() !== input.skills.join();
  const report = trustInputsChanged ? scanAgentRules({ key, ...input }) : null;
  const now = new Date();

  await db
    .update(agents)
    .set({
      ...input,
      updatedAt: now,
      ...(report ? { trustScore: report.score, trustReport: report, trustScannedAt: now } : {}),
    })
    .where(eq(agents.id, row.id));

  if (changes.length) {
    const scoreNote = report && row.trustScore !== null && report.score !== row.trustScore ? ` Trust score ${row.trustScore} → ${report.score}.` : "";
    await logAgentActivity({
      workspaceId,
      agentId: row.id,
      kind: "configured",
      title: "Configuration updated",
      detail: `Changed ${changes.join(", ")}.${scoreNote}`,
    });
  }
  if (row.enabled !== input.enabled) {
    await logAgentActivity({
      workspaceId,
      agentId: row.id,
      kind: input.enabled ? "resumed" : "paused",
      title: input.enabled ? "Resumed" : "Paused",
      detail: input.enabled ? "Picks up work again." : "Won't pick up new work until resumed.",
    });
  }
  return { changed: changes.length > 0 || row.enabled !== input.enabled };
}

export async function saveTrustScan(row: AgentRow, report: TrustReport, costMicros: number) {
  await db
    .update(agents)
    .set({ trustScore: report.score, trustReport: report, trustScannedAt: new Date(report.scannedAt) })
    .where(eq(agents.id, row.id));
  await logAgentActivity({
    workspaceId: row.workspaceId,
    agentId: row.id,
    kind: "scan",
    title: `Trust scan: ${report.score}/100${report.mode === "ai" ? " (AI-assisted)" : ""}`,
    detail: report.summary,
    costMicros,
  });
}

// ── Running ────────────────────────────────────────────────────────────────────

/** Whether an agent may take on a card now: it must be enabled and under this month's budget. */
export async function checkAgentCanRun(workspaceId: number, key: AgentKey) {
  await ensureDefaultAgents(workspaceId);
  const row = await getAgentRow(workspaceId, key);
  const name = AGENT_ROLES[key].name;
  if (!row) return { ok: false as const, error: `${name} isn't set up for this workspace.` };
  if (!row.enabled) return { ok: false as const, error: `${name} is paused. Resume it on the AI Team page to run cards.` };
  if ((await monthSpendMicros(row.id)) >= row.monthlyBudgetCents * 10_000) {
    return { ok: false as const, error: `${name} has used this month's budget. Raise it on the AI Team page to run cards.` };
  }
  return { ok: true as const, row };
}

