import { AGENT_ROLES, formatMicros, type AgentKey } from "@/lib/agent-config";
import {
  AGENT_STAGE,
  PHASE_META,
  RUN_STAGES,
  STAGE_META,
  TOOL_LABEL,
  type AgentStage,
  type AnalystBrief,
  type LeadDecision,
  type MergeMode,
  type ReviewReport,
  type RunStage,
  type SecurityReport,
  type TestReport,
} from "@/lib/agent-run-config";
import type { IssueType } from "@/lib/board-config";

/**
 * The AI Team page's live process: a card in flight as six steps (one per pipeline phase). Pure and client-safe:
 * getTeamOverview (lib/agents.ts) loads a LiveRun, liveProcessSteps turns it into what the page shows. Only tool
 * names and targets reach the client, never tool content.
 */

/** One logged tool call. */
export type LiveAction = { tool: string; target: string | null; ok: boolean; at: Date };

/** One agent's stage in the run's current round (analysis: its only round). */
export type LiveStage = {
  turn: number;
  maxTurns: number;
  costMicros: number;
  /** The latest tool calls, oldest first (at most LIVE_ACTIONS). */
  actions: LiveAction[];
  /** How the stage ended; null while it works. */
  end: { ok: boolean; summary: string | null } | null;
};

/** A queued or running run, as getTeamOverview loads it. */
export type LiveRun = {
  runId: number;
  taskId: number;
  key: string;
  title: string;
  type: IssueType;
  status: "queued" | "running";
  phase: RunStage | null;
  round: number;
  startedAt: Date;
  costMicros: number;
  branch: string | null;
  pullRequest: number | null;
  brief: AnalystBrief | null;
  review: ReviewReport | null;
  securityReport: SecurityReport | null;
  approval: LeadDecision | null;
  testReport: TestReport | null;
  stages: Partial<Record<AgentStage, LiveStage>>;
};

export const LIVE_ACTIONS = 3;

export type StepState = "idle" | "pending" | "working" | "done";

export type LiveStepView = {
  phase: RunStage;
  number: number;
  title: string;
  state: StepState;
  people: { agent: AgentKey; working: boolean }[];
  /** "Analyst", "Reviewer + Security", "Automatic". */
  who: string;
  /** What the step does (idle), is doing (working) or did (done). */
  text: string;
  /** Latest actions while working, oldest first; `agent` is set when two agents share the step. */
  actions: { agent: AgentKey | null; label: string; target: string | null; ok: boolean; at: Date }[];
  /** "Turn 3 of 12 · $0.01 so far" while working. */
  meta: string | null;
};

const IDLE: Record<RunStage, string> = {
  analysis: "Turns a card into a brief, or asks you when something is missing.",
  development: "Builds what the brief asks for on its own branch and opens a pull request.",
  review: "Reviewer and Security check the pull request at the same time.",
  approval: "The Lead combines both reviews, decides on rework and rates the risk.",
  testing: "Verifies the change against the brief and CI.",
  merge: "",
};

const MERGE_IDLE: Record<MergeMode, string> = {
  manual: "Waits for you to merge it on the Pull Requests page.",
  auto_low_risk: "Low risk merges itself once CI is green; medium or high waits for you.",
  auto: "Merges itself once CI is green.",
};

/** How an agent is named at the start of a sentence. */
function subject(agent: AgentKey) {
  return agent === "security" ? "Security" : `The ${AGENT_ROLES[agent].name}`;
}

const prLabel = (run: Pick<LiveRun, "pullRequest" | "branch">) =>
  run.pullRequest ? `PR #${run.pullRequest}` : run.branch ? run.branch : "the pull request";

/** What an agent is doing now, from its latest tool call: "reading src/app.ts", "reading the diff of PR #11". */
function doing(stage: AgentStage, last: LiveAction | undefined, run: Pick<LiveRun, "key" | "pullRequest" | "branch">) {
  const target = last?.target;
  switch (last?.tool) {
    case "list_files":
      return target ? `looking through ${target}` : "looking through the repository";
    case "read_file":
      return target ? `reading ${target}` : "reading the code";
    case "search_code":
      return target ? `searching the code for “${target}”` : "searching the code";
    case "write_file":
      return target ? `writing ${target}` : "writing code";
    case "replace_in_file":
      return target ? `editing ${target}` : "editing code";
    case "delete_file":
      return target ? `deleting ${target}` : "deleting a file";
    case "get_diff":
      return `reading the diff of ${prLabel(run)}`;
    case "get_checks":
      return `checking CI on ${prLabel(run)}`;
    case "search_skill":
      return target ? `searching the skill ${target}` : "searching its skills";
    case "read_skill":
      return target ? `reading the skill guide ${target}` : "reading a skill guide";
  }
  switch (stage) {
    case "analysis":
      return `reading ${run.key} and the repository to write the brief`;
    case "development":
      return run.branch ? `working on branch ${run.branch}` : "setting up its branch";
    case "review":
      return `starting on ${prLabel(run)}`;
    case "security":
      return `starting the security scan of ${prLabel(run)}`;
    case "approval":
      return "combining both reviews and rating the risk";
    case "testing":
      return `verifying ${prLabel(run)} against the brief`;
  }
}

/** "The Developer is editing src/styles.css." for an agent card or a step. */
export function agentDoingSentence(agent: AgentKey, run: LiveRun) {
  const stage = AGENT_STAGE[agent];
  const live = run.stages[stage];
  return `${subject(agent)} is ${doing(stage, live?.actions.at(-1), run)}.`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a finished step produced. */
function doneText(phase: RunStage, run: LiveRun): string {
  switch (phase) {
    case "analysis":
      return run.brief ? `Brief ready: ${run.brief.summary}` : "Brief ready.";
    case "development":
      return run.pullRequest ? `Pull request #${run.pullRequest} is open${run.branch ? ` on ${run.branch}` : ""}.` : "Work committed.";
    case "review": {
      const review = run.review ? (run.review.verdict === "approve" ? "Reviewer approved" : "Reviewer asked for changes") : "Reviewer done";
      const count = run.securityReport?.findings.length ?? 0;
      const security = run.securityReport ? (count ? `Security found ${plural(count, "issue")}` : "Security found nothing") : "Security done";
      return `${review} · ${security}.`;
    }
    case "approval":
      if (!run.approval) return "Decided.";
      return run.approval.decision === "approve"
        ? `Approved · ${run.approval.risk} risk.`
        : `Sent back to the Developer: ${run.approval.summary}`;
    case "testing":
      if (!run.testReport) return "Verified.";
      return `${run.testReport.verdict === "pass" ? "Tests passed" : "Tests failed"} · ${plural(
        run.testReport.checks.filter((c) => c.passed).length,
        "check"
      )} held.`;
    case "merge":
      return "Merged.";
  }
}

/** A stage's own end, when the other agent of its phase still works: "Security finished: no issues." */
function stageEndText(stage: AgentStage, run: LiveRun) {
  if (stage === "security" && run.securityReport) {
    const count = run.securityReport.findings.length;
    return `Security finished: ${count ? plural(count, "issue") : "no issues"}.`;
  }
  if (stage === "review" && run.review) return `The Reviewer finished: ${run.review.verdict === "approve" ? "approved" : "changes requested"}.`;
  return `${subject(STAGE_META[stage].agent)} finished.`;
}

function turnMeta(stage: LiveStage | undefined) {
  if (!stage) return null;
  return stage.turn > 0 ? `turn ${stage.turn} of ${stage.maxTurns}` : `up to ${stage.maxTurns} turns`;
}

function workingStep(phase: RunStage, run: LiveRun): Pick<LiveStepView, "people" | "text" | "actions" | "meta"> {
  const agents = PHASE_META[phase].agents;
  if (!agents.length) {
    return {
      people: [],
      text: `Merging ${prLabel(run)} once GitHub says it can merge and CI is green.`,
      actions: [],
      meta: "No model cost",
    };
  }
  const people = agents.map((agent) => ({ agent, working: !run.stages[AGENT_STAGE[agent]]?.end }));
  const text = people
    .map(({ agent, working }) => (working ? agentDoingSentence(agent, run) : stageEndText(AGENT_STAGE[agent], run)))
    .join(" ");
  const shared = agents.length > 1;
  const actions = agents
    .flatMap((agent) =>
      (run.stages[AGENT_STAGE[agent]]?.actions ?? []).map((action) => ({
        agent: shared ? agent : null,
        label: TOOL_LABEL[action.tool] ?? action.tool,
        target: action.target,
        ok: action.ok,
        at: action.at,
      }))
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-LIVE_ACTIONS);
  const stages = agents.map((agent) => run.stages[AGENT_STAGE[agent]]);
  const cost = stages.reduce((sum, stage) => sum + (stage?.costMicros ?? 0), 0);
  const turns = agents
    .map((agent, i) => {
      const meta = turnMeta(stages[i]);
      return meta && (shared ? `${AGENT_ROLES[agent].name} ${meta}` : meta);
    })
    .filter(Boolean);
  const meta = [...turns, `${formatMicros(cost)} so far`].join(" · ");
  return { people, text, actions, meta: meta.charAt(0).toUpperCase() + meta.slice(1) };
}

/**
 * The six steps for one run in flight, or every step idle when `run` is null (nothing running). A queued run shows
 * every step up next.
 */
export function liveProcessSteps(run: LiveRun | null, mergeMode: MergeMode): LiveStepView[] {
  const current = run?.status === "running" && run.phase ? RUN_STAGES.indexOf(run.phase) : -1;
  return RUN_STAGES.map((phase, index): LiveStepView => {
    const agents = PHASE_META[phase].agents;
    const state: StepState = !run ? "idle" : index < current ? "done" : index === current ? "working" : "pending";
    const base: LiveStepView = {
      phase,
      number: index + 1,
      title: PHASE_META[phase].label,
      state,
      people: agents.map((agent) => ({ agent, working: false })),
      who: agents.length ? agents.map((agent) => AGENT_ROLES[agent].name).join(" + ") : "Automatic",
      text: phase === "merge" ? MERGE_IDLE[mergeMode] : IDLE[phase],
      actions: [],
      meta: null,
    };
    if (!run) return base;
    if (state === "done") return { ...base, text: doneText(phase, run) };
    if (state === "working") return { ...base, ...workingStep(phase, run) };
    return base;
  });
}

/** One line for the card in flight: "Running 2:41 · step 3 of 6 · rework 1". */
export function liveRunMeta(run: LiveRun, now: Date) {
  if (run.status === "queued") return "Queued for the agents";
  const seconds = Math.max(0, Math.floor((now.getTime() - run.startedAt.getTime()) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const step = run.phase ? ` · step ${RUN_STAGES.indexOf(run.phase) + 1} of ${RUN_STAGES.length}` : "";
  return `Running ${elapsed}${step}${run.round > 0 ? ` · rework ${run.round}` : ""}`;
}
