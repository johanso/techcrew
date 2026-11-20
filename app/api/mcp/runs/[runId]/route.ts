import { NextResponse, type NextRequest } from "next/server";

import { isAgentStage } from "@/lib/agent-run-config";
import { cliAgentsAvailable } from "@/lib/cli";
import { verifyMcpRunCredential } from "@/lib/cli/claude-run";
import { stageMcpRegistry } from "@/lib/cli/stage-mcp";
import { handleMcpBody } from "@/lib/mcp-protocol";

// A tool call can run the sandbox (tests, a build) or the browser: give it the sandbox's own limits.
export const maxDuration = 600;

const refuse = (status: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status });

/**
 * TechTeam's MCP endpoint for a CLI agent's stage (Streamable HTTP, stateless, JSON responses): the local CLI that
 * runs the stage (lib/cli/claude-run.ts) lists and calls the stage's tools here. Only on a local instance, only with
 * the bearer derived for this run, stage and round, and only while that stage is the one working.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/mcp/runs/[runId]">) {
  if (!cliAgentsAvailable()) return refuse(404, "Not found.");
  const runId = Number((await ctx.params).runId);
  const query = request.nextUrl.searchParams;
  const stage = query.get("stage");
  const round = Number(query.get("round"));
  const turn = Number(query.get("turn"));
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!Number.isSafeInteger(runId) || runId <= 0 || !isAgentStage(stage) || !Number.isSafeInteger(round) || round < 0 || !Number.isSafeInteger(turn) || turn < 0) {
    return refuse(400, "Bad endpoint address.");
  }
  if (!token || !verifyMcpRunCredential(runId, stage, round, token)) return refuse(401, "Invalid credentials.");

  const registry = await stageMcpRegistry({ runId, stage, round, turn });
  if (!registry) return refuse(404, "This stage isn't working now.");

  const response = await handleMcpBody(registry, await request.text());
  if (response === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(response);
}

// No server-initiated stream and no sessions: a client that asks for either is told so.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
