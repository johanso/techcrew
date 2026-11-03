import "server-only";

import type { GetStepTools } from "inngest";

import { MAX_REWORK_ROUNDS } from "@/lib/agent-run-config";
import { finishRun, getRun } from "@/lib/agent-runs";
import {
  beginStage,
  handleNeedsInfo,
  openPullRequest,
  prepareBranch,
  readyToMerge,
  recordReview,
  recordTestReport,
  runStageTurn,
  saveBrief,
  startRework,
  stopRun,
  type StageResult,
  type TurnStepResult,
  type WorkResult,
} from "@/lib/agent-pipeline";
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
 * One stage: open it, then one durable step per model turn until the agent submits its result.
 * The last allowed turn forces the finish tool, so a stage always ends with a result or a stop reason.
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
  for (let turn = 1; turn <= begun.maxTurns; turn++) {
    const forceFinish = turn === begun.maxTurns;
    const current: LoopState | null = state;
    // Step output is JSON; every field of these results is plain JSON, so the round trip keeps the type.
    const out = (await step.run(`${id}-turn-${turn}`, () =>
      runStageTurn({ runId, stage, activityId: begun.activityId, state: current, forceFinish, work })
    )) as unknown as TurnStepResult<S>;
    if (out.kind === "done") return out.result;
    if (out.kind === "stopped") {
      await step.run(`${id}-stopped`, () => stopRun(runId, out.reason, begun.activityId));
      return null;
    }
    state = out.state;
  }
  await step.run(`${id}-out-of-turns`, () => stopRun(runId, `Ran out of turns (${begun.maxTurns}) without a result.`, begun.activityId));
  return null;
}

/**
 * The agent pipeline for one board card: Analyst → Developer → Reviewer → Tester → merge.
 * Review or tests can send the work back to the Developer up to MAX_REWORK_ROUNDS times.
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

      const review = await runStage(step, runId, "review", round, work);
      if (!review) return { stopped: "review" };
      await step.run(`record-review-${round}`, () => recordReview(runId, review));
      if (review.verdict === "request_changes") {
        if (round >= MAX_REWORK_ROUNDS) {
          await step.run("review-exhausted", () =>
            stopRun(runId, `The reviewer still requests changes after ${MAX_REWORK_ROUNDS} rework rounds. See PR #${pr.number}.`, null)
          );
          return { stopped: "review" };
        }
        await step.run(`rework-after-review-${round}`, () => startRework(runId));
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

    // Merge: auto (Settings → Agents) waits for GitHub and CI; manual leaves it on the Pull Requests page.
    const { autoMerge } = await step.run("ready-to-merge", () => readyToMerge(runId));
    if (!autoMerge) return { awaitingMerge: true };
    for (let attempt = 1; attempt <= MERGE_ATTEMPTS; attempt++) {
      const outcome = await step.run(`merge-${attempt}`, async () => {
        const pr = await getRunPullRequest(runId);
        return pr ? mergeAgentPullRequest(pr) : { status: "error" as const, reason: "The run has no pull request." };
      });
      if (outcome.status !== "pending") {
        if (outcome.status === "error") await step.run("merge-error", () => stopRun(runId, outcome.reason, null));
        return { merge: outcome.status };
      }
      await step.sleep(`merge-wait-${attempt}`, "30s");
    }
    // Still pending after ten minutes: hand it to the user instead of waiting forever.
    await step.run("merge-timeout", () =>
      finishRun(runId, "awaiting_merge", "Checks were still running after 10 minutes. Merge it from Pull Requests once they pass.")
    );
    return { awaitingMerge: true };
  }
);
