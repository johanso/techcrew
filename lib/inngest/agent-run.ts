import "server-only";

import type { GetStepTools } from "inngest";

import { MAX_REWORK_ROUNDS } from "@/lib/agent-run-config";
import { getRun } from "@/lib/agent-runs";
import {
  beginStage,
  handleNeedsInfo,
  mergeTimedOut,
  notifyMerged,
  openPullRequest,
  pollCi,
  prepareBranch,
  readyToMerge,
  recordApproval,
  recordReview,
  recordSecurity,
  recordTestReport,
  runStageTurn,
  saveBrief,
  startCiWait,
  startRework,
  stopRun,
  type StageResult,
  type TurnStepResult,
  type WorkResult,
} from "@/lib/agent-pipeline";
import { CI_MAX_POLLS, CI_POLL_SECONDS, type CiResult } from "@/lib/ci-gate";
import { getRunPullRequest, mergeAgentPullRequest } from "@/lib/pull-requests";
import { inngest } from "@/lib/inngest/client";
import type { LoopState } from "@/lib/agent-loop";

/** Sent by the board's Run action and by auto pickup, after the run row is created. */
export const AGENT_TASK_RUN = "agent/task.run";
/** Sent by Stop: cancels the run's function wherever it is (between steps). */
export const AGENT_TASK_CANCEL = "agent/task.cancel";

export type AgentTaskRunData = { workspaceId: number; taskId: number; runId: number };

type Step = GetStepTools<typeof inngest>;

// Auto-merge waits for GitHub's mergeability and CI: up to 20 checks, 30 s apart (10 minutes).
const MERGE_ATTEMPTS = 20;

/**
 * One agent's stage: open it, then one durable step per model turn until the agent submits its result.
 * The last allowed turn forces the finish tool, so a stage always ends with a result or a stop reason.
 * Step ids start with the stage, so two stages can run in parallel (Promise.all) without colliding.
 */
async function runStage<S extends keyof StageResult>(
  step: Step,
  runId: number,
  stage: S,
  round: number,
  work: WorkResult | null = null
): Promise<StageResult[S] | null> {
  const id = `${stage}-${round}`;
  const begun = await step.run(`${id}-start`, () => beginStage(runId, stage));
  if (!begun.ok) return null;

  let state: LoopState | null = null;
  let restarted = false;
  for (let turn = 1; turn <= begun.maxTurns; turn++) {
    const forceFinish = turn === begun.maxTurns;
    const current: LoopState | null = state;
    // Step output is JSON; every field of these results is plain JSON, so the round trip keeps the type.
    const out = (await step.run(`${id}-turn-${turn}`, () =>
      runStageTurn({ runId, stage, activityId: begun.activityId, state: current, forceFinish, work })
    )) as unknown as TurnStepResult<S>;
    if (out.kind === "done") return out.result;
    if (out.kind === "stopped") {
      await step.run(`${id}-stopped`, () => stopRun(runId, out.reason, begun.activityId, "failed", out.failure ?? null, stage));
      return null;
    }
    if (out.kind === "restart") {
      // Once per stage: a second provider change in the same stage means neither can work right now.
      if (restarted) {
        await step.run(`${id}-stopped`, () =>
          stopRun(runId, `${out.reason} The other provider failed too.`, begun.activityId, "failed", null, stage)
        );
        return null;
      }
      restarted = true;
      state = null;
      continue;
    }
    state = out.state;
  }
  await step.run(`${id}-out-of-turns`, () =>
    stopRun(runId, `Ran out of turns (${begun.maxTurns}) without a result.`, begun.activityId, "failed", null, stage)
  );
  return null;
}

/**
 * The CI gate after a push: one durable step per poll, sleeping in between (free while it waits). Null when there is
 * no branch to check. The first poll comes sooner: a repository without CI shouldn't hold the card long.
 */
async function waitForCi(step: Step, runId: number, round: number): Promise<CiResult | null> {
  const start = await step.run(`ci-${round}-start`, () => startCiWait(runId));
  const sha = start.sha;
  if (!sha) return null;
  for (let poll = 1; poll <= CI_MAX_POLLS; poll++) {
    await step.sleep(`ci-${round}-wait-${poll}`, poll === 1 ? "10s" : `${CI_POLL_SECONDS}s`);
    const result = await step.run(`ci-${round}-poll-${poll}`, () => pollCi(runId, sha, poll, start.hasWorkflows));
    if (result) return result;
  }
  return null;
}

/**
 * The agent pipeline for one board card: Analyst → Developer → CI → Reviewer and Security (in parallel) → Lead → Tester
 * → merge. A failing CI, the Lead or the tests can send the work back to the Developer up to MAX_REWORK_ROUNDS times.
 */
export const agentTaskRun = inngest.createFunction(
  {
    id: "agent-task-run",
    name: "Agent pipeline: run a board card",
    retries: 2,
    // One run per card at a time.
    concurrency: { key: "event.data.taskId", limit: 1 },
    cancelOn: [{ event: AGENT_TASK_CANCEL, match: "data.runId" }],
    onFailure: async ({ event, error, step }) => {
      const { runId } = event.data.event.data as AgentTaskRunData;
      await step.run("mark-failed", () => stopRun(runId, error.message || "The run stopped on an unexpected error.", null));
    },
  },
  { event: AGENT_TASK_RUN },
  async ({ event, step }) => {
    const { runId } = event.data as AgentTaskRunData;
    const run = await step.run("load-run", () => getRun(runId));
    if (!run || run.status !== "queued") return { skipped: true };

    // Analysis: the analyst decides whether the card can go to the developer.
    const brief = await runStage(step, runId, "analysis", 0);
    if (!brief) return { stopped: "analysis" };
    if (brief.decision === "needs_info") {
      await step.run("needs-info", () => handleNeedsInfo(runId, brief));
      return { needsInfo: true };
    }
    await step.run("save-brief", () => saveBrief(runId, brief));

    for (let round = 0; ; round++) {
      await step.run(`branch-${round}`, () => prepareBranch(runId));
      const work = await runStage(step, runId, "development", round);
      if (!work) return { stopped: "development" };

      const pr = await step.run(`pull-request-${round}`, () => openPullRequest(runId, work));
      if (!pr.ok) {
        await step.run(`no-changes-${round}`, () => stopRun(runId, pr.error, null));
        return { stopped: "pull-request" };
      }

      // CI gate: a push that breaks the build goes back to the developer with the failures before anyone reviews it.
      const ci = await waitForCi(step, runId, round);
      if (ci?.state === "failed") {
        if (round >= MAX_REWORK_ROUNDS) {
          await step.run("ci-exhausted", () =>
            stopRun(
              runId,
              `CI still fails after ${MAX_REWORK_ROUNDS} rework rounds (${ci.failing.map((c) => c.name).join(", ")}). See PR #${pr.number}.`,
              null
            )
          );
          return { stopped: "ci" };
        }
        await step.run(`rework-after-ci-${round}`, () => startRework(runId));
        continue;
      }

      // Code review and security review read the same pull request at the same time; each turn is still its own step.
      const [review, security] = await Promise.all([
        runStage(step, runId, "review", round, work),
        runStage(step, runId, "security", round, work),
      ]);
      if (!review || !security) return { stopped: "review" };
      await step.run(`record-review-${round}`, () => recordReview(runId, review));
      await step.run(`record-security-${round}`, () => recordSecurity(runId, security));

      const lead = await runStage(step, runId, "approval", round, work);
      if (!lead) return { stopped: "approval" };
      const approval = await step.run(`record-approval-${round}`, () => recordApproval(runId, lead));
      if (approval.decision === "request_changes") {
        if (round >= MAX_REWORK_ROUNDS) {
          await step.run("approval-exhausted", () =>
            stopRun(runId, `The Lead still requests changes after ${MAX_REWORK_ROUNDS} rework rounds. See PR #${pr.number}.`, null)
          );
          return { stopped: "approval" };
        }
        await step.run(`rework-after-approval-${round}`, () => startRework(runId));
        continue;
      }

      const tested = await runStage(step, runId, "testing", round, work);
      if (!tested) return { stopped: "testing" };
      const report = await step.run(`record-test-${round}`, () => recordTestReport(runId, tested, work));
      if (report.verdict === "fail") {
        if (round >= MAX_REWORK_ROUNDS) {
          await step.run("tests-exhausted", () =>
            stopRun(runId, `Verification still fails after ${MAX_REWORK_ROUNDS} rework rounds. See PR #${pr.number}.`, null)
          );
          return { stopped: "testing" };
        }
        await step.run(`rework-after-tests-${round}`, () => startRework(runId));
        continue;
      }
      break;
    }

    // Merge: automatic (Settings → Agents: always, or when the Lead rated it low risk) waits for GitHub and CI;
    // otherwise it waits for the owner on the Pull Requests page.
    const { autoMerge } = await step.run("ready-to-merge", () => readyToMerge(runId));
    if (!autoMerge) return { awaitingMerge: true };
    for (let attempt = 1; attempt <= MERGE_ATTEMPTS; attempt++) {
      const outcome = await step.run(`merge-${attempt}`, async () => {
        const pr = await getRunPullRequest(runId);
        return pr ? mergeAgentPullRequest(pr) : { status: "error" as const, reason: "The run has no pull request." };
      });
      if (outcome.status !== "pending") {
        if (outcome.status === "error") await step.run("merge-error", () => stopRun(runId, outcome.reason, null));
        if (outcome.status === "merged") await step.run("merged-notice", () => notifyMerged(runId));
        return { merge: outcome.status };
      }
      await step.sleep(`merge-wait-${attempt}`, "30s");
    }
    // Still pending after ten minutes: hand it to the user instead of waiting forever.
    await step.run("merge-timeout", () => mergeTimedOut(runId));
    return { awaitingMerge: true };
  }
);
