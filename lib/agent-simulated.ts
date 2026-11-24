import "server-only";

import type { FunctionTool } from "openai/resources/responses/responses";

import type { LoopState, TurnOutcome } from "@/lib/agent-loop";
import { callTool, type ToolContext, type ToolStep } from "@/lib/agent-tools";

/**
 * Simulated agents (AGENTS_SIMULATED=true): a scripted stand-in for the model, for trying the pipeline locally
 * without an API key or spend. Each stage takes two turns: one real tool call (so GitHub reads, the developer's
 * commit, the diff and CI checks really happen), then the stage's finish tool with a fixed, passing result: the
 * Reviewer and Security approve with no findings and the Lead approves at low risk (the risk floor still applies).
 * With Brain notes for the workspace it also searches the first note and reads it (search_memory, read_memory).
 * An agent with skills switched on also searches its first skill and reads the top match in that first turn, so the
 * skill tools run for free too, and on a card with references it lists them and reads the first one (an image is read
 * from storage like for a model, then dropped: nothing looks at it). With the sandbox on, the Developer (after its commit) and the Tester also run the tests
 * and the build for real, and with previews on the Tester opens the preview's home page in the browser (tablet, dark).
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
        relevant_references: ctx.references?.items.length ? [`${ctx.references.items[0]!.name}: read in simulated mode, nothing to follow.`] : [],
        developer_notes: "",
        question: "",
      };
    case "submit_work":
      return {
        summary: `Simulated implementation: added ${path}. No model was called.`,
        changed_files: [path],
        pull_request_title: "Simulated agent run",
        notes_for_reviewer: "",
        complete: true,
        remaining_work: [],
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
  const found = await callTool(input.toolContext, input.tools, "search_skill", searchArgs);
  const path = /^- (\S+) — /m.exec(found.output)?.[1] ?? "SKILL.md";
  const readArgs = JSON.stringify({ skill: skill.slug, path, offset: null });
  const read = await callTool(input.toolContext, input.tools, "read_skill", readArgs);
  return [found.step, read.step];
}

/** search_memory with the first note's title, then read_memory on the top match, when the agent has the memory tools. */
async function memoryCalls(input: { toolContext: ToolContext; tools: FunctionTool[] }): Promise<ToolStep[]> {
  const first = input.toolContext.memory?.notes[0];
  if (!first || !input.tools.some((tool) => tool.name === "search_memory")) return [];
  const found = await callTool(input.toolContext, input.tools, "search_memory", JSON.stringify({ query: first.title, files: null }));
  const key = /^- (\S+) — /m.exec(found.output)?.[1] ?? first.key;
  const read = await callTool(input.toolContext, input.tools, "read_memory", JSON.stringify({ key, offset: null }));
  return [found.step, read.step];
}

/** list_references, then read_reference on the card's first reference, when the agent has the reference tools. */
async function referenceCalls(input: { toolContext: ToolContext; tools: FunctionTool[] }): Promise<ToolStep[]> {
  const first = input.toolContext.references?.items[0];
  if (!first || !input.tools.some((tool) => tool.name === "list_references")) return [];
  const listed = await callTool(input.toolContext, input.tools, "list_references", "{}");
  const read = await callTool(input.toolContext, input.tools, "read_reference", JSON.stringify({ id: first.id, offset: null }));
  return [listed.step, read.step];
}

/**
 * run_tests then run_build, each when the agent has it (lib/sandbox: real containers, no model); then browse_preview
 * on the preview's home page, at tablet size in dark mode, when the agent has it (the Tester with previews on: a real
 * browser; its screenshot is attached like for a model that sees, then dropped).
 */
async function sandboxCalls(input: { toolContext: ToolContext; tools: FunctionTool[] }): Promise<ToolStep[]> {
  const steps: ToolStep[] = [];
  const calls: [string, string][] = [
    ["run_tests", "{}"],
    ["run_build", "{}"],
    // The newer options (tablet, dark) on purpose: they're the ones the reference comparison uses.
    ["browse_preview", JSON.stringify({ path: "/", viewport: "tablet", color_scheme: "dark", steps: [] })],
  ];
  for (const [name, args] of calls) {
    if (!input.tools.some((tool) => tool.name === name)) continue;
    steps.push((await callTool(input.toolContext, input.tools, name, args)).step);
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
  const memorySteps = await memoryCalls(input);
  const referenceSteps = await referenceCalls(input);
  const args = JSON.stringify(call.args);
  const { output, step } = await callTool(input.toolContext, input.tools, call.name, args);
  // A failed write must not pass as success: surface it the way a model's stage would fail.
  if (call.name === "write_file" && !output.startsWith("Created") && !output.startsWith("Updated")) {
    throw new Error(`Simulated developer couldn't write its file: ${output}`);
  }
  const sandboxSteps = input.finish.name === "submit_work" || input.finish.name === "submit_test_report" ? await sandboxCalls(input) : [];
  return { state: next, costMicros: 0, steps: [...skillSteps, ...memorySteps, ...referenceSteps, step, ...sandboxSteps], result: null };
}
