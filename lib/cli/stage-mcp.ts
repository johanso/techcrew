import "server-only";

import { cliStageTools } from "@/lib/agent-pipeline";
import type { AgentStage } from "@/lib/agent-run-config";
import { appendRunStep, saveCliResult } from "@/lib/agent-runs";
import { callTool } from "@/lib/agent-tools";
import { MCP_SERVER_NAME } from "@/lib/cli/claude-config";
import { mcpToolsFrom, type McpContent, type McpRegistry } from "@/lib/mcp-protocol";
import { parseFinishArguments } from "@/lib/openrouter";
import { missingImageNote } from "@/lib/reference-images";

/**
 * TechTeam's tools for a CLI agent's stage, as an MCP registry (lib/mcp-protocol.ts). The same tools an API turn gets
 * (toolsFor: permissions are tools), through the same callTool path, so the agent log, the live process, references,
 * skills, the sandbox and the merge tools behave the same. Every call is logged as it happens. The finish tool stores
 * the stage's result for the stage's step to read after the chunk (lib/agent-pipeline.ts cliTurn).
 */

// Text a tool returns stays inline up to this size instead of a file the agent couldn't open (it has no file tools).
// Tool outputs are already clipped below this (lib/agent-tools.ts).
const MAX_RESULT_CHARS = 100_000;

const text = (value: string): McpContent => ({ type: "text", text: value });

export type StagePosition = { runId: number; stage: AgentStage; round: number; turn: number };

/** The registry for one run's stage, or null when that stage isn't working now (the endpoint answers 404). */
export async function stageMcpRegistry(at: StagePosition): Promise<McpRegistry | null> {
  const stage = await cliStageTools(at.runId, at.stage, at.round);
  if (!stage) return null;
  const { finish } = stage;
  return {
    server: { name: MCP_SERVER_NAME, version: "1" },
    instructions: `TechTeam's tools for this stage. Finish by calling ${finish.name} exactly once.`,
    listTools: async () => mcpToolsFrom([...stage.tools, finish], MAX_RESULT_CHARS),
    callTool: async (name, args) => {
      if (name === finish.name) {
        const parsed = parseFinishArguments(JSON.stringify(args), finish);
        if (!parsed.ok) return { content: [text(parsed.error)], isError: true };
        await saveCliResult(at.runId, `${at.stage}:${at.round}`, parsed.value);
        return { content: [text("Result recorded: your stage is complete. Reply with one short line and stop; don't call any more tools.")] };
      }
      const { output, step, images } = await callTool(stage.toolContext, stage.tools, name, JSON.stringify(args));
      await appendRunStep(at.runId, { stage: at.stage, round: at.round, turn: at.turn, model: stage.model }, step);
      const content: McpContent[] = [text(output)];
      // Images only reach a model that sees them (callTool already returns none otherwise), loaded per call, never stored.
      for (const image of images) {
        const loaded = await stage.loadImage(image);
        content.push(loaded ? { type: "image", data: loaded.base64, mimeType: loaded.mediaType } : text(missingImageNote(image)));
      }
      return { content, isError: !step.ok };
    },
  };
}
