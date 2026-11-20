import type { AgentStage, ReviewReport, SecurityReport, WorkResult } from "@/lib/agent-run-config";

/**
 * The turn limit of a stage, as pure rules (lib/agent-loop.ts sends the messages, lib/agent-pipeline.ts acts on the
 * decisions): the warning a few turns before the end, the last-turn message, and what happens when an agent still ends
 * its last turn without its finish tool. A big card shouldn't lose a stage's work to the limit (run 53: 40 turns of
 * development, then no result and no pull request).
 */

/** Turns left (the last one included) when the agent is told to wrap up. */
export const TURNS_LEFT_NOTICE_AT = 3;
// Short stages have no room to wrap up early; the last-turn message is enough there.
const NOTICE_MIN_MAX_TURNS = 8;

/**
 * The note added after a turn's tool results when only TURNS_LEFT_NOTICE_AT turns remain (the next one included), or
 * null. `turn` is the turn that just ran (from 1).
 */
export function turnsLeftNotice(turn: number, maxTurns: number, finish: string): string | null {
  if (maxTurns < NOTICE_MIN_MAX_TURNS || maxTurns - turn !== TURNS_LEFT_NOTICE_AT) return null;
  return `${TURNS_LEFT_NOTICE_AT} turns left, the last one only for ${finish}. Wrap up now: batch the edits you still need in one turn and leave the rest for your result.`;
}

/** The last turn's instruction: finish now, and on the Developer's stage say precisely what's left instead of giving up. */
export function lastTurnMessage(finish: string): string {
  if (finish === "submit_work") {
    return "This is your last turn. Call submit_work now; do not call any other tool. If the work isn't complete, submit what's done with complete: false and list in remaining_work precisely what's left (each acceptance criterion or file still to do): the Lead sends it back to you for another round on the same branch with a full set of turns.";
  }
  return `This is your last turn. Call ${finish} now with your result; do not call any other tool. If you couldn't check everything, say in your summary what you left unchecked.`;
}

/** What the pipeline knows when a stage ended its last turn without a result. */
export type OutOfTurnsFacts = {
  stage: AgentStage;
  maxTurns: number;
  /** Commits on the branch ahead of the default branch (null: no branch, or GitHub didn't say). */
  aheadBy: number | null;
  /** The branch's head now, and the head the last round's CI checked (rework rounds), to tell whether this round committed. */
  headSha: string | null;
  previousRoundSha: string | null;
  /** Files changed on the branch against the default branch. */
  changedFiles: string[];
  taskTitle: string;
};

export type OutOfTurnsOutcome =
  | { kind: "continue"; result: WorkResult | ReviewReport | SecurityReport }
  | { kind: "stop"; reason: string };

/**
 * A stage ran out of turns without calling its finish tool. The Developer's work goes on when this round committed
 * something (the Lead decides, and can send it back for another round); the Reviewer's and Security's missing reports
 * become failed checks the Lead sees (and the risk floor raises). The Analyst, the Lead and the Tester stop the run:
 * the next step needs their decision, and none can be made up.
 */
export function outOfTurnsOutcome(facts: OutOfTurnsFacts): OutOfTurnsOutcome {
  const ran = `ran out of turns (${facts.maxTurns}) before submitting`;
  const stop = (who: string): OutOfTurnsOutcome => ({ kind: "stop", reason: `The ${who} ${ran} a result.` });
  switch (facts.stage) {
    case "development": {
      if (!facts.aheadBy) return { kind: "stop", reason: `Ran out of turns (${facts.maxTurns}) without a result or a commit.` };
      // A rework round that committed nothing would only send the same branch round again.
      if (facts.headSha && facts.previousRoundSha && facts.headSha === facts.previousRoundSha) {
        return { kind: "stop", reason: `Ran out of turns (${facts.maxTurns}) in a rework round without a result or a new commit.` };
      }
      return { kind: "continue", result: outOfTurnsWork(facts) };
    }
    case "review":
      return {
        kind: "continue",
        result: {
          verdict: "request_changes",
          summary: `The Reviewer ${ran} a verdict: this round's code review is missing.`,
          findings: [],
          incomplete: true,
        } satisfies ReviewReport,
      };
    case "security":
      return {
        kind: "continue",
        result: {
          verdict: "issues",
          summary: `Security ${ran} its report: this round's security review is missing.`,
          findings: [],
          incomplete: true,
        } satisfies SecurityReport,
      };
    case "analysis":
      return stop("Analyst");
    case "approval":
      return stop("Lead");
    case "testing":
      return stop("Tester");
  }
}

/** The Developer's result when it ran out of turns with commits on the branch: incomplete, with the measured files. */
function outOfTurnsWork(facts: OutOfTurnsFacts): WorkResult {
  return {
    summary: `The Developer ran out of turns (${facts.maxTurns}) before submitting its work. What it committed is on the branch; it didn't report what's done.`,
    changedFiles: facts.changedFiles,
    pullRequestTitle: facts.taskTitle.slice(0, 120),
    notesForReviewer: "Unfinished: the Developer ran out of turns. Compare the diff with the acceptance criteria.",
    complete: false,
    remaining: ["Not reported (the Developer ran out of turns): every acceptance criterion the diff doesn't cover yet."],
    outOfTurns: true,
  };
}

/**
 * The branch a new run of a card continues instead of starting over: the newest earlier run's branch when that run
 * stopped (failed or cancelled) before any pull request was opened from it. Null otherwise (no branch, a PR exists: the
 * PR path continues it, or the run ended another way). The caller still checks the branch has commits on GitHub.
 */
export function continuableBranch(earlier: { branch: string | null; status: string } | null, branchesWithPullRequest: readonly string[]): string | null {
  if (!earlier?.branch || !["failed", "cancelled"].includes(earlier.status)) return null;
  return branchesWithPullRequest.includes(earlier.branch) ? null : earlier.branch;
}
