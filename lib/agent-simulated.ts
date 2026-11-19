import "server-only";

import type { FunctionTool } from "openai/resources/responses/responses";

import type { LoopState, TurnOutcome } from "@/lib/agent-loop";
import { executeTool, toolStep, type ToolContext, type ToolStep } from "@/lib/agent-tools";

/**
 * Simulated agents (AGENTS_SIMULATED=true): a scripted stand-in for the model, for trying the pipeline locally
 * without an API key or spend. Each stage takes two turns: one real tool call (so GitHub reads, the developer's
 * commit, the diff and CI checks really happen), then the stage's finish tool with a fixed, passing result: the
 * Reviewer and Security approve with no findings and the Lead approves at low risk (the risk floor still applies).
 * An agent with skills switched on also searches its first skill and reads the top match in that first turn, so the
 * skill tools run for free too. With the sandbox on, the Developer (after its commit) and the Tester also run the tests
 * and the build for real.
 */

export function isSimulatedAgents() {
  return process.env.AGENTS_SIMULATED === "true";
}

// Long enough to watch a card move through the columns (the board polls every 10 s), short enough to wait for.
const TURN_DELAY_MS = 4_000;

type Call = { name: string; args: Record<string, unknown> };

/** The developer's file: one per branch, so reruns and rework rounds update it instead of piling up files. */
const simulatedPath = (ctx: ToolContext) => `agent-simulations/${(ctx.branch ?? "work").replace(/^agent\//, "")}.md`;

function firstTurnCall(finish: string, ctx: ToolContext, tools: FunctionTool[]): Call | null {
  const has = (name: string) => tools.some((tool) => tool.name === name);
  switch (finish) {
    case "submit_analysis":
      return has("list_files") ? { name: "list_files", args: { path_prefix: "" } } : null;
    case "submit_work":
      return has("write_file")
        ? {
            name: "write_file",
            args: {
              path: simulatedPath(ctx),
              content: `# Simulated agent run\n\nWritten by the TechTeam Developer in simulated mode on \`${ctx.branch}\`.\nNo model was called; this file only proves the pipeline end to end.\n\nUpdated: ${new Date().toISOString()}\n`,
              commit_message: "Add simulated agent run note",
            },
          }
        : null;
    case "submit_review":
    case "submit_security_review":
    case "submit_approval":
      return has("get_diff") ? { name: "get_diff", args: {} } : null;
    case "submit_test_report":
      return has("get_checks") ? { name: "get_checks", args: {} } : has("get_diff") ? { name: "get_diff", args: {} } : null;
    default:
      return null;
  }
}

function finishResult(finish: string, ctx: ToolContext): unknown {
  const path = simulatedPath(ctx);
  switch (finish) {
    case "submit_analysis":
      return {
        decision: "ready",
        summary: "Simulated analysis: no model was called. The developer adds a note file on the working branch.",
        // No branch exists yet during analysis, so the brief names the folder, not the file.
        acceptance_criteria: ["A note file under agent-simulations/ exists on the working branch."],
        plan: ["Create agent-simulations/<branch>.md describing the run."],
        relevant_files: ["agent-simulations/"],
        developer_notes: "",
        question: "",
      };
    case "submit_work":
      return {
        summary: `Simulated implementation: added ${path}. No model was called.`,
        changed_files: [path],
        pull_request_title: "Simulated agent run",
        notes_for_reviewer: "",
      };
    case "submit_review":
      return { verdict: "approve", summary: "Simulated review: approved without findings.", findings: [] };
    case "submit_security_review":
      return { verdict: "pass", summary: "Simulated security review: no secrets, injection or permission problems in the diff.", findings: [] };
    case "submit_approval":
      return {
        decision: "approve",
        risk: "low",
        risk_reasons: ["Simulated run: one note file under agent-simulations/."],
        summary: "Simulated approval: both reviews passed, so the change goes on to testing.",
        required_changes: [],
      };
    default:
      return {
        verdict: "pass",
        summary: "Simulated verification: the note file is on the branch.",
        checks: [{ name: "Simulated check", passed: true, detail: `${path} is in the diff.` }],
      };
  }
}

// What each stage's simulated agent looks up in its first skill.
const SKILL_QUERY: Record<string, string> = {
  submit_analysis: "best practices",
  submit_work: "responsive layout",
  submit_review: "accessibility",
  submit_security_review: "sanitize html",
  submit_approval: "best practices",
  submit_test_report: "testing",
};

/** search_skill on the agent's first skill, then read_skill on the top match (or SKILL.md when nothing matched). */
async function skillCalls(input: { finish: FunctionTool; toolContext: ToolContext; tools: FunctionTool[] }): Promise<ToolStep[]> {
  const skill = input.toolContext.skills[0];
  if (!skill || !input.tools.some((tool) => tool.name === "search_skill")) return [];
  const searchArgs = JSON.stringify({ skill: skill.slug, query: SKILL_QUERY[input.finish.name] ?? "best practices" });
  const found = await executeTool(input.toolContext, input.tools, "search_skill", searchArgs);
  const path = /^- (\S+) — /m.exec(found)?.[1] ?? "SKILL.md";
  const readArgs = JSON.stringify({ skill: skill.slug, path, offset: null });
  const read = await executeTool(input.toolContext, input.tools, "read_skill", readArgs);
  return [toolStep("search_skill", searchArgs, found), toolStep("read_skill", readArgs, read)];
}

/** run_tests then run_build, each when the agent has it (lib/sandbox: real containers, no model). */
async function sandboxCalls(input: { toolContext: ToolContext; tools: FunctionTool[] }): Promise<ToolStep[]> {
  const steps: ToolStep[] = [];
  for (const name of ["run_tests", "run_build"]) {
    if (!input.tools.some((tool) => tool.name === name)) continue;
    const output = await executeTool(input.toolContext, input.tools, name, "{}");
    steps.push(toolStep(name, "{}", output));
  }
  return steps;
}

/** One scripted turn, shaped like a model turn: tool call first, the stage's result on the next turn (or when forced). */
export async function simulatedTurn<T>(input: {
  tools: FunctionTool[];
  finish: FunctionTool;
  toolContext: ToolContext;
  state: LoopState;
  forceFinish: boolean;
}): Promise<TurnOutcome<T>> {
  await new Promise((resolve) => setTimeout(resolve, TURN_DELAY_MS));
  const turn = input.state.turn + 1;
  const call = input.state.turn === 0 && !input.forceFinish ? firstTurnCall(input.finish.name, input.toolContext, input.tools) : null;
  const next: LoopState = { ...input.state, turn };

  if (!call) {
    return { state: next, costMicros: 0, steps: [], result: finishResult(input.finish.name, input.toolContext) as T };
  }
  const skillSteps = await skillCalls(input);
  const args = JSON.stringify(call.args);
  const output = await executeTool(input.toolContext, input.tools, call.name, args);
  // A failed write must not pass as success: surface it the way a model's stage would fail.
  if (call.name === "write_file" && !output.startsWith("Created") && !output.startsWith("Updated")) {
    throw new Error(`Simulated developer couldn't write its file: ${output}`);
  }
  const sandboxSteps = input.finish.name === "submit_work" || input.finish.name === "submit_test_report" ? await sandboxCalls(input) : [];
  return { state: next, costMicros: 0, steps: [...skillSteps, toolStep(call.name, args, output), ...sandboxSteps], result: null };
}
