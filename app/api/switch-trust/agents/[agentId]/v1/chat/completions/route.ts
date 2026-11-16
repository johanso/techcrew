import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { answerEvaluation } from "@/lib/switch-eval";
import { verifyAgentEndpointCredential } from "@/lib/switch-trust";
import { parseEvalMessages } from "@/lib/switch-trust-config";

// A test waits on one model turn; leave room for a slow one.
export const maxDuration = 120;

const error = (status: number, message: string) => NextResponse.json({ error: { message } }, { status });

/**
 * OpenAI-compatible chat endpoint Switch Trust calls to evaluate one agent (registered by lib/switch-trust.ts).
 * Authenticated with the agent's derived bearer credential, which only Switch has.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/switch-trust/agents/[agentId]/v1/chat/completions">) {
  const agentId = Number((await ctx.params).agentId);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!Number.isInteger(agentId) || agentId <= 0 || !token || !verifyAgentEndpointCredential(agentId, token)) {
    return error(401, "Invalid credentials.");
  }

  const messages = parseEvalMessages(await request.json().catch(() => null));
  if (!messages) return error(400, "Send messages with at least one user turn.");

  try {
    const answer = await answerEvaluation(agentId, messages);
    if (!answer.ok) return error(answer.status, answer.error);
    return NextResponse.json({
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: answer.model,
      choices: [{ index: 0, message: { role: "assistant", content: answer.content }, finish_reason: "stop" }],
    });
  } catch (cause) {
    console.error("[switch-eval] answer failed", cause);
    return error(502, "The agent's model didn't answer.");
  }
}
