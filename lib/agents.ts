import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { agentActivity, agentRunSteps, agentRuns, agents, db, pullRequests, tasks, workspaces, type AgentRow, type Workspace } from "@/db";
import {
  AGENT_KEYS,
  AGENT_ROLES,
  PROVIDER_IDS,
  PROVIDERS,
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  DESCRIPTION_MAX,
  INSTRUCTIONS_MAX,
  INSTRUCTIONS_MIN,
  PERMISSION_BY_ID,
  formatCents,
  isAgentKey,
  isPermissionId,
  agentModel,
  agentModelFor,
  defaultProvider,
  roleDefaultModel,
  type Agent,
  type AgentKey,
  type AgentModelId,
  type AgentProvider,
  type AgentTone,
  type PermissionId,
  type ProviderStatus,
} from "@/lib/agent-config";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_STAGE,
  MAX_TURNS_MAX,
  MAX_TURNS_MIN,
  STAGE_META,
  isAgentStage,
  isRunStage,
  parseMergeMode,
  workingAgents,
} from "@/lib/agent-run-config";
import { getEndedStages, getWorkingAgents } from "@/lib/agent-runs";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { ensureBuiltinSkills, getEnabledSkillIds, getTrustSkills } from "@/lib/agent-skills";
import { ISSUE_TYPES, type IssueType } from "@/lib/board-config";
import { ciForRound } from "@/lib/ci-gate";
import { LIVE_ACTIONS, agentDoingSentence, type LiveRun, type LiveStage } from "@/lib/live-process";
import { scanAgentRules, type TrustReport } from "@/lib/agent-trust";
import { getModelCatalog } from "@/lib/model-catalog";
import { catalogLabel, findModel, isModelId, modelProvider, type ModelCatalog } from "@/lib/model-catalog-config";
import type { TrustScanView } from "@/lib/switch-trust-config";

/**
 * AI agents of a workspace: the six roles from lib/agent-config.ts, persisted in `agents` and created on first use.
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
  // One pipeline stage on a card; its cost grows turn by turn while the agent works.
  "task_run",
  "pull_request",
  "issue_filed",
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

/** Starts a stage's activity row; the pipeline adds cost to it each turn and rewrites the title when done. */
export async function startAgentActivity(values: { workspaceId: number; agentId: number; title: string; detail?: string | null; taskId: number }) {
  const [row] = await db
    .insert(agentActivity)
    .values({ ...values, kind: "task_run" })
    .returning({ id: agentActivity.id });
  return row!.id;
}

export async function addActivityCost(activityId: number, costMicros: number) {
  if (costMicros <= 0) return;
  await db
    .update(agentActivity)
    .set({ costMicros: sql`${agentActivity.costMicros} + ${costMicros}` })
    .where(eq(agentActivity.id, activityId));
}

/**
 * A plan chunk's usage on the stage's activity row: tokens, and the CLI's API-equivalent cost as a reference. Never
 * cost_micros: plan usage isn't spend and never counts toward a budget.
 */
export async function addActivityPlanUsage(activityId: number, usage: { tokens: number; equivalentMicros: number }) {
  await db
    .update(agentActivity)
    .set({
      billing: "plan",
      tokens: sql`${agentActivity.tokens} + ${Math.max(0, Math.round(usage.tokens))}`,
      equivalentMicros: sql`${agentActivity.equivalentMicros} + ${Math.max(0, Math.round(usage.equivalentMicros))}`,
    })
    .where(eq(agentActivity.id, activityId));
}

export async function updateAgentActivity(activityId: number, values: { title: string; detail?: string | null }) {
  await db.update(agentActivity).set(values).where(eq(agentActivity.id, activityId));
}

/** Turns per stage: the configured value, else the role default. */
export function agentMaxTurns(row: Pick<AgentRow, "key" | "maxTurns">) {
  return row.maxTurns ?? (isAgentKey(row.key) ? AGENT_ROLES[row.key].defaults.maxTurns : 20);
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/**
 * Creates any of the default agents this workspace doesn't have yet, each with a first (rule-based) trust
 * scan, then the built-in skills with their default assignments (ensureBuiltinSkills). Safe to call on every
 * request: concurrent calls can't duplicate thanks to (workspace_id, key).
 */
export async function ensureDefaultAgents(workspaceId: number) {
  const existing = await db.select({ key: agents.key }).from(agents).where(eq(agents.workspaceId, workspaceId));
  const missing = AGENT_KEYS.filter((key) => !existing.some((row) => row.key === key));
  if (!missing.length) return ensureBuiltinSkills(workspaceId);
  // Each agent can later move to any company on the AI Team page; they start on one that has a key.
  const provider = defaultProvider(keyStatus(await getAIKeys(workspaceId)));
  const catalog = await getModelCatalog();

  const now = new Date();
  const inserted = await db
    .insert(agents)
    .values(
      missing.map((key) => {
        const { defaults } = AGENT_ROLES[key];
        const model = roleDefaultModel(catalog, key, provider);
        const monthlyBudgetCents = defaults.monthlyBudgetUsd * 100;
        const report = scanAgentRules({ key, instructions: defaults.instructions, permissions: defaults.permissions, monthlyBudgetCents });
        return {
          workspaceId,
          key,
          description: defaults.description,
          instructions: defaults.instructions,
          model,
          providerModels: { [provider]: model },
          permissions: defaults.permissions,
          monthlyBudgetCents,
          maxTurns: defaults.maxTurns,
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
  // New agents get their role's built-in skills.
  await ensureBuiltinSkills(workspaceId, true);
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

export async function monthSpendMicros(agentId: number) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${agentActivity.costMicros}), 0)::int` })
    .from(agentActivity)
    .where(and(eq(agentActivity.agentId, agentId), gte(agentActivity.createdAt, monthWindow().start)));
  return row?.total ?? 0;
}

export type AccountSpend = {
  /** First day of the month (UTC), ISO. */
  monthStart: string;
  totalMicros: number;
  /** Every workspace the user owns, biggest spend first (zero included). */
  byWorkspace: { id: number; name: string; micros: number }[];
  /** Per agent role across all workspaces, biggest first. */
  byAgent: { key: AgentKey; micros: number }[];
  /** Stages that ran on the owner's plans (local CLIs): usage, not spend. */
  plan: { stages: number; tokens: number; equivalentMicros: number };
};

/** Settings → Your account: this month's model spend across every workspace the user owns. */
export async function getAccountSpend(userId: number): Promise<AccountSpend> {
  const { start } = monthWindow();
  const [owned, rows, [plan]] = await Promise.all([
    db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.ownerId, userId)),
    db
      .select({
        workspaceId: agentActivity.workspaceId,
        key: agents.key,
        // float8: a sum over many projects can pass int's $2,147.
        micros: sql<number>`coalesce(sum(${agentActivity.costMicros}), 0)::float8`,
      })
      .from(agentActivity)
      .innerJoin(workspaces, eq(workspaces.id, agentActivity.workspaceId))
      .innerJoin(agents, eq(agents.id, agentActivity.agentId))
      .where(and(eq(workspaces.ownerId, userId), gte(agentActivity.createdAt, start)))
      .groupBy(agentActivity.workspaceId, agents.key),
    db
      .select({
        stages: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${agentActivity.tokens}), 0)::float8`,
        equivalentMicros: sql<number>`coalesce(sum(${agentActivity.equivalentMicros}), 0)::float8`,
      })
      .from(agentActivity)
      .innerJoin(workspaces, eq(workspaces.id, agentActivity.workspaceId))
      .where(and(eq(workspaces.ownerId, userId), eq(agentActivity.billing, "plan"), gte(agentActivity.createdAt, start))),
  ]);
  const sum = (filter: (row: (typeof rows)[number]) => boolean) => rows.filter(filter).reduce((total, row) => total + Number(row.micros), 0);
  return {
    monthStart: start.toISOString(),
    totalMicros: sum(() => true),
    byWorkspace: owned.map((w) => ({ ...w, micros: sum((row) => row.workspaceId === w.id) })).sort((a, b) => b.micros - a.micros),
    byAgent: AGENT_KEYS.map((key) => ({ key, micros: sum((row) => row.key === key) }))
      .filter((row) => row.micros > 0)
      .sort((a, b) => b.micros - a.micros),
    plan: { stages: plan?.stages ?? 0, tokens: Number(plan?.tokens ?? 0), equivalentMicros: Number(plan?.equivalentMicros ?? 0) },
  };
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
  /** The model's name (the catalog's label, else its id). */
  modelLabel: string;
  /** Whether the catalog still offers the model; false: an older model the agent keeps until it's changed. */
  modelCurrent: boolean;
  permissions: PermissionId[];
  /** Ids of the library skills switched on for this agent (agent_skill_assignments). */
  skillIds: number[];
  monthlyBudgetCents: number;
  maxTurns: number;
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
  /** The name of the model the trust report scored, when it names one. */
  trustModelLabel: string | null;
  /** Latest SwitchAgent scan (lib/switch-trust.ts), pending or finished; null when never scanned with Switch. */
  scan: TrustScanView | null;
  /** Last configuration change: a Switch report older than this describes an earlier configuration. */
  configuredAt: string;
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

/**
 * Everything the AI Team page shows. Creates the default agents on first visit. `scans` are the latest SwitchAgent
 * scans by agent row id (getLatestTrustScans), read by the page.
 */
export async function getAgentTeam(
  workspace: Pick<Workspace, "id">,
  scans: Map<number, TrustScanView> = new Map()
): Promise<{ agents: AgentView[]; stats: AgentTeamStats }> {
  await ensureDefaultAgents(workspace.id);
  const { start, end } = monthWindow();
  const catalog = await getModelCatalog();

  const [rows, spendRows, taskRows, activityRows, working, skillIds] = await Promise.all([
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
    getWorkingAgents(workspace.id),
    getEnabledSkillIds(workspace.id),
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
        model: activeAgentModel(row),
        modelLabel: catalogLabel(catalog, activeAgentModel(row)),
        modelCurrent: Boolean(findModel(catalog, activeAgentModel(row))?.current),
        permissions: row.permissions.filter(isPermissionId),
        skillIds: skillIds.get(key) ?? [],
        monthlyBudgetCents: row.monthlyBudgetCents,
        maxTurns: agentMaxTurns(row),
        enabled: row.enabled,
        status: !row.enabled ? "paused" : overBudget ? "over_budget" : working.has(key) ? "working" : "ready",
        openTasks,
        spend: {
          monthMicros,
          byCategory,
          projectedMicros: Math.round((monthMicros / elapsedDays) * monthDays),
          resetsAt: end.toISOString(),
        },
        trust: row.trustReport ?? null,
        trustModelLabel: row.trustReport?.model ? catalogLabel(catalog, row.trustReport.model) : null,
        scan: scans.get(row.id) ?? null,
        configuredAt: row.updatedAt.toISOString(),
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

/** One agent as the Overview and the AI Team page show it live. */
export type TeamMember = Agent & {
  status: AgentStatus;
  /** What it is doing right now, e.g. "Reviewing ACM-142" (a running run at its stage, until its stage ends). */
  currentTask: string | null;
  /** The card behind `currentTask`, with when its run started. */
  task: { key: string; title: string; startedAt: Date } | null;
  /** What it is doing on that card, from its latest tool call: "The Developer is editing src/app.ts." */
  doing: string | null;
  /** Latest work on a card (assigned, stage, pull request, issue filed); setup events don't count. */
  lastAction: { title: string; at: Date } | null;
  /** Label of the active model, e.g. "Claude Sonnet 5.5". */
  model: string;
  monthSpendMicros: number;
  monthlyBudgetCents: number;
};

const WORK_KINDS: AgentActivityKind[] = ["task_assigned", "task_run", "pull_request", "issue_filed"];

/**
 * Queued and running runs of the workspace with what each agent of the current round did, for the live process.
 * Read-only. Steps carry tool names and targets only (agent_run_steps never stores content).
 */
async function getLiveRuns(workspace: Pick<Workspace, "id" | "name">, rows: AgentRow[]): Promise<LiveRun[]> {
  const runs = await db
    .select({ run: agentRuns, number: tasks.number, title: tasks.title, type: tasks.type, pr: pullRequests.number })
    .from(agentRuns)
    .innerJoin(tasks, eq(tasks.id, agentRuns.taskId))
    .leftJoin(pullRequests, eq(pullRequests.runId, agentRuns.id))
    .where(and(eq(agentRuns.workspaceId, workspace.id), inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES])))
    .orderBy(asc(agentRuns.startedAt));
  if (!runs.length) return [];

  const ids = runs.map(({ run }) => run.id);
  const [steps, activity] = await Promise.all([
    db
      .select({
        runId: agentRunSteps.runId,
        stage: agentRunSteps.stage,
        round: agentRunSteps.round,
        turn: agentRunSteps.turn,
        tool: agentRunSteps.tool,
        target: agentRunSteps.target,
        ok: agentRunSteps.ok,
        summary: agentRunSteps.summary,
        costMicros: agentRunSteps.costMicros,
        at: agentRunSteps.createdAt,
      })
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .orderBy(asc(agentRunSteps.createdAt), asc(agentRunSteps.turn), asc(agentRunSteps.seq)),
    // A working stage's spend so far lives on its open task_run activity row (the result row comes at the end).
    db
      .select({ agentId: agentActivity.agentId, taskId: agentActivity.taskId, costMicros: agentActivity.costMicros, at: agentActivity.createdAt })
      .from(agentActivity)
      .where(and(eq(agentActivity.workspaceId, workspace.id), eq(agentActivity.kind, "task_run"), inArray(agentActivity.taskId, runs.map(({ run }) => run.taskId))))
      .orderBy(desc(agentActivity.createdAt), desc(agentActivity.id)),
  ]);

  const prefix = taskKeyPrefix(workspace.name);
  return runs.map(({ run, number, title, type, pr }): LiveRun => {
    const stages: LiveRun["stages"] = {};
    for (const step of steps) {
      // Analysis runs once (round 0); every other stage is shown for the current rework round.
      if (step.runId !== run.id || !isAgentStage(step.stage)) continue;
      if (step.stage !== "analysis" && step.round !== run.reworkRounds) continue;
      const agent = STAGE_META[step.stage].agent;
      const row = rows.find((r) => r.key === agent);
      const live: LiveStage = (stages[step.stage] ??= {
        turn: 0,
        maxTurns: row ? agentMaxTurns(row) : AGENT_ROLES[agent].defaults.maxTurns,
        costMicros: 0,
        actions: [],
        end: null,
      });
      live.turn = Math.max(live.turn, step.turn);
      if (step.tool === "result" || step.tool === "stopped") {
        live.end = { ok: step.tool === "result", summary: step.summary };
        live.costMicros = step.costMicros;
      } else {
        live.actions = [...live.actions, { tool: step.tool, target: step.target, ok: step.ok, at: step.at }].slice(-LIVE_ACTIONS);
      }
    }
    for (const [stage, live] of Object.entries(stages) as [keyof typeof stages, LiveStage][]) {
      if (live.end) continue;
      const row = rows.find((r) => r.key === STAGE_META[stage].agent);
      const open = row && activity.find((a) => a.agentId === row.id && a.taskId === run.taskId && a.at >= run.startedAt);
      live.costMicros = open?.costMicros ?? 0;
    }
    return {
      runId: run.id,
      taskId: run.taskId,
      key: `${prefix}-${number}`,
      title,
      type: (ISSUE_TYPES as readonly string[]).includes(type) ? (type as IssueType) : "issue",
      status: run.status === "queued" ? "queued" : "running",
      phase: isRunStage(run.stage) ? run.stage : null,
      round: run.reworkRounds,
      startedAt: run.startedAt,
      ci: ciForRound(run.ci, run.reworkRounds),
      costMicros: run.costMicros,
      branch: run.branch,
      pullRequest: pr ?? null,
      brief: run.brief ?? null,
      review: run.review ?? null,
      securityReport: run.securityReport ?? null,
      approval: run.approval ?? null,
      testReport: run.testReport ?? null,
      stages,
    };
  });
}

/**
 * Every agent with its live status, plus the runs in flight, for the Overview and the AI Team page (polled).
 * Read-only: unlike getAgentTeam it never creates agents, so a role without a row yet shows its defaults (ready,
 * never active).
 */
export async function getTeamOverview(workspace: Pick<Workspace, "id" | "name" | "agentMergeMode">) {
  const { start } = monthWindow();
  const prefix = taskKeyPrefix(workspace.name);

  const [rows, spendRows, lastRows, runningRows, [latestRun]] = await Promise.all([
    db.select().from(agents).where(eq(agents.workspaceId, workspace.id)),
    db
      .select({ agentId: agentActivity.agentId, total: sql<number>`sum(${agentActivity.costMicros})::int` })
      .from(agentActivity)
      .where(and(eq(agentActivity.workspaceId, workspace.id), gte(agentActivity.createdAt, start)))
      .groupBy(agentActivity.agentId),
    db
      .selectDistinctOn([agentActivity.agentId], { agentId: agentActivity.agentId, title: agentActivity.title, at: agentActivity.createdAt })
      .from(agentActivity)
      .where(and(eq(agentActivity.workspaceId, workspace.id), inArray(agentActivity.kind, WORK_KINDS)))
      .orderBy(agentActivity.agentId, desc(agentActivity.createdAt), desc(agentActivity.id)),
    db
      .select({
        id: agentRuns.id,
        stage: agentRuns.stage,
        reworkRounds: agentRuns.reworkRounds,
        number: tasks.number,
        title: tasks.title,
        startedAt: agentRuns.startedAt,
      })
      .from(agentRuns)
      .innerJoin(tasks, eq(tasks.id, agentRuns.taskId))
      .where(and(eq(agentRuns.workspaceId, workspace.id), eq(agentRuns.status, "running")))
      .orderBy(agentRuns.startedAt),
    db
      .select({ status: agentRuns.status, failure: agentRuns.failure })
      .from(agentRuns)
      .where(eq(agentRuns.workspaceId, workspace.id))
      .orderBy(desc(agentRuns.updatedAt))
      .limit(1),
  ]);
  // A company is out of credit while the latest run stopped for it and some agent still works on it (until a run
  // gets going again).
  const broke = latestRun?.status === "failed" && latestRun.failure?.kind === "out_of_credit" ? latestRun.failure.provider : null;
  const outOfCredit = broke && rows.some((row) => modelProvider(activeAgentModel(row)) === broke) ? broke : null;
  const catalog = await getModelCatalog();

  const [ended, runs] = await Promise.all([getEndedStages(runningRows), getLiveRuns(workspace, rows)]);
  const current = new Map<AgentKey, { label: string; task: NonNullable<TeamMember["task"]>; doing: string | null }>();
  for (const run of runningRows) {
    if (!isRunStage(run.stage)) continue;
    const key = `${prefix}-${run.number}`;
    const live = runs.find((r) => r.runId === run.id);
    for (const agent of workingAgents(run.stage, ended.get(run.id) ?? [])) {
      if (current.has(agent)) continue;
      const { verb } = STAGE_META[AGENT_STAGE[agent]];
      current.set(agent, {
        label: `${verb} ${key}`,
        task: { key, title: run.title, startedAt: run.startedAt },
        doing: live ? agentDoingSentence(agent, live) : null,
      });
    }
  }

  let monthSpendMicros = 0;
  let monthBudgetCents = 0;
  const members = AGENT_KEYS.map((key): TeamMember => {
    const row = rows.find((r) => r.key === key);
    const spent = row ? (spendRows.find((s) => s.agentId === row.id)?.total ?? 0) : 0;
    const budgetCents = row?.monthlyBudgetCents ?? AGENT_ROLES[key].defaults.monthlyBudgetUsd * 100;
    monthSpendMicros += spent;
    monthBudgetCents += budgetCents;
    const working = current.get(key);
    const last = row ? lastRows.find((l) => l.agentId === row.id) : undefined;
    const status: AgentStatus =
      row && !row.enabled ? "paused" : spent >= budgetCents * 10_000 ? "over_budget" : working ? "working" : "ready";
    return {
      ...getAgent(key)!,
      status,
      currentTask: working?.label ?? null,
      task: working?.task ?? null,
      doing: working?.doing ?? null,
      lastAction: last ? { title: last.title, at: last.at } : null,
      model: catalogLabel(catalog, row ? activeAgentModel(row) : roleDefaultModel(catalog, key, "openai")),
      monthSpendMicros: spent,
      monthlyBudgetCents: budgetCents,
    };
  });

  return { members, monthSpendMicros, monthBudgetCents, outOfCredit, runs, mergeMode: parseMergeMode(workspace.agentMergeMode) };
}

export type TeamOverview = Awaited<ReturnType<typeof getTeamOverview>>;

// ── Configuration ──────────────────────────────────────────────────────────────

export type AgentConfigInput = {
  description: string;
  instructions: string;
  model: AgentModelId;
  permissions: PermissionId[];
  monthlyBudgetCents: number;
  maxTurns: number;
  enabled: boolean;
};

export type AgentConfigField = "description" | "instructions" | "model" | "permissions" | "budget" | "maxTurns";

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

  // The shape only: whether the catalog offers it is checked by the save (saveAgentAction).
  if (!isModelId(input.model)) errors.model = "Choose a model.";

  const permissions = Array.isArray(input.permissions) ? [...new Set(input.permissions.filter(isPermissionId))] : [];
  if (!permissions.length) errors.permissions = "Grant at least one permission.";

  const budget = typeof input.monthlyBudgetUsd === "number" ? input.monthlyBudgetUsd : Number.NaN;
  if (!Number.isFinite(budget) || budget < BUDGET_MIN_USD || budget > BUDGET_MAX_USD) {
    errors.budget = `Set a budget between $${BUDGET_MIN_USD} and $${BUDGET_MAX_USD.toLocaleString()}.`;
  }

  const maxTurns = typeof input.maxTurns === "number" ? input.maxTurns : Number.NaN;
  if (!Number.isInteger(maxTurns) || maxTurns < MAX_TURNS_MIN || maxTurns > MAX_TURNS_MAX) {
    errors.maxTurns = `Allow between ${MAX_TURNS_MIN} and ${MAX_TURNS_MAX} turns.`;
  }

  if (Object.keys(errors).length) return { ok: false, error: "Check the highlighted fields.", errors };
  return {
    ok: true,
    value: {
      description,
      instructions,
      model: input.model as string,
      permissions,
      monthlyBudgetCents: Math.round(budget * 100),
      maxTurns,
      enabled: input.enabled !== false,
    },
  };
}

/** "Instructions, model (GPT-6.1 Sol → GPT-6 Luna), permissions (+Web research)" — for the activity log. */
function describeChanges(row: AgentRow, next: AgentConfigInput, catalog: ModelCatalog) {
  const modelLabel = (id: string) => catalogLabel(catalog, id);
  const changes: string[] = [];
  if (row.description !== next.description) changes.push("description");
  if (row.instructions !== next.instructions) changes.push("instructions");
  if (row.model !== next.model) changes.push(`model (${modelLabel(row.model)} → ${modelLabel(next.model)})`);
  const added = next.permissions.filter((s) => !row.permissions.includes(s));
  const removed = row.permissions.filter((s) => !next.permissions.includes(s as PermissionId)) as PermissionId[];
  if (added.length || removed.length) {
    const parts = [...added.map((s) => `+${PERMISSION_BY_ID[s].name}`), ...removed.filter(isPermissionId).map((s) => `−${PERMISSION_BY_ID[s].name}`)];
    changes.push(`permissions (${parts.join(", ")})`);
  }
  if (row.monthlyBudgetCents !== next.monthlyBudgetCents) {
    changes.push(`budget (${formatCents(row.monthlyBudgetCents)} → ${formatCents(next.monthlyBudgetCents)})`);
  }
  if (agentMaxTurns(row) !== next.maxTurns) changes.push(`max turns (${agentMaxTurns(row)} → ${next.maxTurns})`);
  return changes;
}

/**
 * Saves the dialog's configuration. When anything the trust score depends on changes, the rule scan re-runs so
 * the score never describes a configuration that no longer exists.
 */
export async function updateAgentConfig(workspaceId: number, key: AgentKey, input: AgentConfigInput) {
  const row = await getAgentRow(workspaceId, key);
  if (!row) return null;
  const provider = modelProvider(input.model);
  if (!provider) return null;

  const changes = describeChanges(row, input, await getModelCatalog());
  const trustInputsChanged =
    row.instructions !== input.instructions ||
    row.monthlyBudgetCents !== input.monthlyBudgetCents ||
    row.permissions.join() !== input.permissions.join();
  // A Switch evaluation stays until the next SwitchAgent scan (the panel flags it as older than the change); a rule
  // or AI score is recomputed so it never describes a configuration that no longer exists.
  const report =
    trustInputsChanged && row.trustReport?.mode !== "switch" ? scanAgentRules({ key, ...input, skills: await getTrustSkills(row.id) }) : null;
  const now = new Date();

  await db
    .update(agents)
    .set({
      ...input,
      // Remembered per provider, so a provider switch and back keeps this choice.
      providerModels: { ...row.providerModels, [provider]: input.model },
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

/** The model an agent runs on now (its company follows from it: each agent can be on any of them). */
export function activeAgentModel(row: AgentRow) {
  return agentModel(row.key as AgentKey, row.model);
}

/** The workspace's agent rows, in no particular order. */
export async function getAgentTeamRows(workspaceId: number) {
  return db.select().from(agents).where(eq(agents.workspaceId, workspaceId));
}

/** The companies the workspace's agents run on now. */
export async function teamProviders(workspaceId: number): Promise<ProviderStatus> {
  const rows = await getAgentTeamRows(workspaceId);
  const used = new Set(rows.map((row) => modelProvider(activeAgentModel(row))));
  return Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, used.has(provider)])) as ProviderStatus;
}

/**
 * Out of credit on `from`: moves every agent working on it to its model on `to` — the one it had there before, else
 * the closest equivalent (agentModelFor) — and remembers the model it leaves, so moving back restores it. Agents on
 * `to` already stay. Running stages keep their model; the next stage uses the new one. Returns how many moved.
 */
export async function moveAgentsToProvider(workspaceId: number, from: AgentProvider, to: AgentProvider, why: string) {
  await ensureDefaultAgents(workspaceId);
  const rows = await db.select().from(agents).where(eq(agents.workspaceId, workspaceId));
  const catalog = await getModelCatalog();
  const modelLabel = (id: string) => catalogLabel(catalog, id);
  let moved = 0;
  for (const row of rows) {
    const current = activeAgentModel(row);
    if (modelProvider(current) !== from) continue;
    const next = agentModelFor(catalog, row.key as AgentKey, to, current, row.providerModels);
    await db
      .update(agents)
      .set({ model: next, providerModels: { ...row.providerModels, [from]: current, [to]: next }, updatedAt: new Date() })
      .where(eq(agents.id, row.id));
    await logAgentActivity({
      workspaceId,
      agentId: row.id,
      kind: "configured",
      title: `Switched to ${PROVIDERS[to].label}`,
      detail: `Changed model (${modelLabel(current)} → ${modelLabel(next)}): ${why}`,
    });
    moved++;
  }
  return moved;
}

/**
 * Re-runs the rule-based trust scan on the saved configuration after something it weighs changed outside the
 * dialog (a skill switched on or off, a new skill version). A Switch evaluation stays, as it does for dialog saves:
 * the panel flags it as older than the change. Returns the new score, or null when nothing was rescanned.
 */
export async function refreshRuleTrust(row: AgentRow) {
  if (row.trustReport?.mode === "switch" || !isAgentKey(row.key)) return null;
  const report = scanAgentRules({
    key: row.key,
    instructions: row.instructions,
    permissions: row.permissions.filter(isPermissionId),
    monthlyBudgetCents: row.monthlyBudgetCents,
    skills: await getTrustSkills(row.id),
  });
  await db
    .update(agents)
    .set({ trustScore: report.score, trustReport: report, trustScannedAt: new Date(report.scannedAt) })
    .where(eq(agents.id, row.id));
  return report.score;
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
    title: report.mode === "switch" ? `SwitchAgent scan: ${report.score}/100` : `Trust scan: ${report.score}/100${report.mode === "ai" ? " (AI-assisted)" : ""}`,
    detail: report.summary,
    costMicros,
  });
}

// ── Running ────────────────────────────────────────────────────────────────────

/**
 * Whether an agent may take on a card now: it must be enabled and under this month's budget. `onPlan`: its stage goes
 * through the owner's plan on this computer, which spends nothing, so the budget doesn't apply (max turns is the brake).
 */
export async function checkAgentCanRun(workspaceId: number, key: AgentKey, { onPlan = false } = {}) {
  await ensureDefaultAgents(workspaceId);
  const row = await getAgentRow(workspaceId, key);
  const name = AGENT_ROLES[key].name;
  if (!row) return { ok: false as const, error: `${name} isn't set up for this workspace.` };
  if (!row.enabled) return { ok: false as const, error: `${name} is paused. Resume it on the AI Team page to run cards.` };
  if (!onPlan && (await monthSpendMicros(row.id)) >= row.monthlyBudgetCents * 10_000) {
    return { ok: false as const, error: `${name} has used this month's budget. Raise it on the AI Team page to run cards.` };
  }
  return { ok: true as const, row };
}

