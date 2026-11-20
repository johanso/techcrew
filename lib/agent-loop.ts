import "server-only";

import { and, asc, eq, lt, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import OpenAI from "openai";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { FunctionTool, ResponseInput } from "openai/resources/responses/responses";

import { agentRunMessages, db } from "@/db";
import { PROVIDERS, modelInfo, type AgentModelId, type ProviderStatus } from "@/lib/agent-config";
import { compactChatHistory } from "@/lib/agent-context";
import { claudeEffort, openAIRequestParams, openRouterRequestParams } from "@/lib/agent-request-params";
import type { AgentStage } from "@/lib/agent-run-config";
import { isSimulatedAgents, simulatedTurn } from "@/lib/agent-simulated";
import { callTool, type ToolContext, type ToolStep } from "@/lib/agent-tools";
import { lastTurnMessage } from "@/lib/agent-turns";
import { anthropicClient, messageCostMicros, toClaudeSchema } from "@/lib/anthropic";
import { openAIClient, responseCostMicros } from "@/lib/openai";
import { OPENROUTER_ROUTING, completionCostMicros, openRouterClient, parseFinishArguments } from "@/lib/openrouter";
import {
  chatImagesMessage,
  claudeToolResultContent,
  hydrateChatMessages,
  hydrateClaudeMessages,
  hydrateOpenAIInput,
  memoLoader,
  openAIToolOutput,
  type ImageLoader,
} from "@/lib/reference-images";

/**
 * One turn of an agent's tool loop, on the agent's model provider. The pipeline calls it once per Inngest step,
 * so a long stage survives restarts and every turn is retried on its own.
 *
 * - OpenAI (Responses API) keeps the conversation server-side (`previous_response_id`); between turns we only
 *   carry the tool outputs still to send.
 * - Anthropic (Messages API) and OpenRouter (Chat Completions) are stateless: the conversation is stored in
 *   agent_run_messages and the state only says how many of its messages are committed, so a retried turn overwrites
 *   its own rows instead of appending.
 *
 * Images an agent gets (read_reference, browse_preview screenshots) are kept as placeholders in the state and the
 * stored history, and loaded from private storage for each request (lib/reference-images.ts): no base64 in the
 * database or in step output.
 *
 * A stage ends when the agent calls its finish tool (structured result). On the last allowed turn the agent is
 * told to finish, with what's left when the work isn't done (lib/agent-turns.ts); OpenAI also forces the finish
 * tool, OpenRouter offers only it, and Claude 5.5 models reject forced tools, so there it's the instruction alone. A few
 * turns before the end the agent is told to wrap up (`notice`, after that turn's tool results).
 *
 * Context per turn: OpenAI compacts server-side past a threshold; Claude clears old tool uses server-side (context
 * editing, which keeps its thinking blocks valid); OpenRouter folds older turns into a digest at send time
 * (lib/agent-context.ts). Request knobs per model and stage: lib/agent-request-params.ts.
 */

export type LoopState = {
  turn: number;
  /** Pinned on the stage's first turn: changing the agent's model mid-stage applies from its next stage. */
  model: AgentModelId;
} & (
  | {
      provider: "openai";
      previousResponseId: string | null;
      /** Input for the next turn: the task brief first, then tool outputs. */
      pending: ResponseInput;
    }
  | {
      provider: "anthropic" | "openrouter";
      runId: number;
      conversation: string;
      /** Messages of the conversation committed so far (seq 0 … length-1). */
      length: number;
    }
);

export type TurnOutcome<T> = {
  state: LoopState;
  costMicros: number;
  /** Tool calls made this turn (the finish call isn't one: the stage's result is logged on its own). */
  steps: ToolStep[];
  result: T | null;
};

/** Why an agent on this model can't work right now, or null when it can. Simulated agents need no provider. */
export function modelUnavailableReason(model: AgentModelId, providers: ProviderStatus) {
  if (isSimulatedAgents()) return null;
  const { provider, label } = modelInfo(model);
  if (providers[provider]) return null;
  return `${label} needs an ${PROVIDERS[provider].label} API key. Add one in Settings → AI providers.`;
}

/**
 * First state of a stage's conversation. For Claude the brief is stored as message 0 right away (idempotent),
 * so every later turn just reads the committed history.
 */
export async function initialLoopState(input: { brief: string; model: AgentModelId; runId: number; conversation: string }): Promise<LoopState> {
  const { provider } = modelInfo(input.model);
  if (provider === "openai") {
    return { turn: 0, model: input.model, provider: "openai", previousResponseId: null, pending: [{ role: "user", content: input.brief }] };
  }
  // The same first message on both stateless APIs.
  await saveMessages(input.runId, input.conversation, 0, [{ role: "user", content: input.brief }]);
  return { turn: 0, model: input.model, provider, runId: input.runId, conversation: input.conversation, length: 1 };
}

const NUDGE = "Continue working with your tools. When you're done, call the finish tool with your result.";

type TurnInput = {
  /** The agent stage: some request knobs differ per stage (lib/agent-request-params.ts). */
  stage: AgentStage;
  /** The workspace's key for the state's provider (lib/ai-keys.ts). */
  apiKey: string | null;
  /** System prompt: the agent's configured instructions plus the stage protocol. */
  instructions: string;
  tools: FunctionTool[];
  finish: FunctionTool;
  toolContext: ToolContext;
  state: LoopState;
  forceFinish: boolean;
  /** A note for the agent after this turn's tool results (turns left, lib/agent-turns.ts), or null. Stored with them. */
  notice: string | null;
  /** Loads an image (a reference of the run's card, a screenshot of this run) as base64 for the request (null when gone). */
  loadImage: ImageLoader;
};

export async function agentTurn<T>(input: TurnInput): Promise<TurnOutcome<T>> {
  if (isSimulatedAgents()) return simulatedTurn<T>(input);
  const { state } = input;
  if (state.provider === "openai") return openAITurn<T>(input, state);
  return state.provider === "anthropic" ? claudeTurn<T>(input, state) : openRouterTurn<T>(input, state);
}

// ── OpenAI (Responses API) ─────────────────────────────────────────────────────

// Agent turns read whole files and reason over them; give them longer than the client's default.
const OPENAI_TURN_TIMEOUT_MS = 180_000;
// Server-side compaction (Responses `context_management`, works with previous_response_id): past this many tokens the
// server compacts the conversation into an opaque item that carries state and reasoning forward. High on purpose: cached
// input is cheap on OpenAI, so it's a guard for the longest stages, not a step every few turns.
const OPENAI_COMPACT_THRESHOLD = 120_000;
// Request parameters that only tune cost; never worth failing a turn over.
const OPTIONAL_OPENAI_PARAMS = ["context_management", "text", "reasoning"];

async function openAITurn<T>(input: TurnInput, state: Extract<LoopState, { provider: "openai" }>): Promise<TurnOutcome<T>> {
  if (!input.apiKey) throw new NonRetriableError("The OpenAI API key was removed. Add it again in Settings → AI providers.");
  const openai = openAIClient(input.apiKey);

  const tools = [...input.tools, input.finish];
  // The finish tool is forced on the last turn; the message says how to finish unfinished work (not stored: the stage ends).
  const pending: ResponseInput = input.forceFinish ? [...state.pending, { role: "user", content: lastTurnMessage(input.finish.name) }] : state.pending;
  const request = {
    model: state.model,
    instructions: input.instructions,
    input: await hydrateOpenAIInput(pending, memoLoader(input.loadImage)),
    tools,
    tool_choice: input.forceFinish ? ({ type: "function", name: input.finish.name } as const) : ("auto" as const),
    previous_response_id: state.previousResponseId,
  };
  const knobs = { context_management: [{ type: "compaction", compact_threshold: OPENAI_COMPACT_THRESHOLD }], ...openAIRequestParams(state.model, input.stage) };
  let response: OpenAI.Responses.Response;
  try {
    response = await openai.responses.create({ ...request, ...knobs }, { timeout: OPENAI_TURN_TIMEOUT_MS });
  } catch (error) {
    // The knobs only save tokens: a model that rejects one still gets its turn, without them.
    if (!(error instanceof OpenAI.BadRequestError && OPTIONAL_OPENAI_PARAMS.some((param) => error.param?.startsWith(param)))) throw error;
    console.warn(`[agents] ${state.model} rejected ${error.param}; retrying the turn without the optional parameters`);
    response = await openai.responses.create(request, { timeout: OPENAI_TURN_TIMEOUT_MS });
  }
  const costMicros = responseCostMicros(state.model, response.usage);
  const next = (pending: ResponseInput): LoopState => ({ ...state, turn: state.turn + 1, previousResponseId: response.id, pending });

  const calls = response.output.filter((item) => item.type === "function_call");
  const finish = calls.find((call) => call.name === input.finish.name);
  if (finish) {
    // Strict schema: the arguments already match the finish tool's shape.
    return { state: next([]), costMicros, steps: [], result: JSON.parse(finish.arguments) as T };
  }
  const notice: ResponseInput = input.notice ? [{ role: "user", content: input.notice }] : [];
  if (!calls.length) {
    // Text without a tool call: keep the agent moving instead of ending the stage on prose.
    return { state: next([{ role: "user", content: NUDGE }, ...notice]), costMicros, steps: [], result: null };
  }

  const outputs: ResponseInput = [];
  const steps: ToolStep[] = [];
  for (const call of calls) {
    const { output, step, images } = await callTool(input.toolContext, input.tools, call.name, call.arguments);
    outputs.push({ type: "function_call_output", call_id: call.call_id, output: openAIToolOutput(output, images) });
    steps.push(step);
  }
  return { state: next([...outputs, ...notice]), costMicros, steps, result: null };
}

// ── Anthropic (Messages API) ───────────────────────────────────────────────────

// Room for a whole file in one write_file call plus thinking. Streamed, so a long turn can't hit an HTTP timeout.
const CLAUDE_MAX_TOKENS = 32_000;
// Opus and Sonnet 5.5 can decline a request on a safety classifier; "default" retries it on Anthropic's
// recommended fallback model server-side instead of failing the stage. Haiku has no server-side fallback.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS: AgentModelId[] = ["claude-opus-5-5", "claude-sonnet-5-5"];

/**
 * Server-side context editing: past the trigger, Anthropic clears the oldest tool uses (results and inputs: file
 * contents, test output, whole files written) and keeps the latest ones. Server-side, so the conversation we send stays
 * append-only and Claude's thinking blocks stay valid (5.5 models check the history they were made in; a client-side
 * trim would invalidate them). Each clear restarts the prompt cache from that point, so it clears in large steps
 * (`clear_at_least`) and only on long stages: it guards the context window more than it saves.
 */
const CONTEXT_EDITING_BETA = "context-management-2025-06-27";
const CLAUDE_CONTEXT_MANAGEMENT = {
  edits: [
    {
      type: "clear_tool_uses_20250919" as const,
      trigger: { type: "input_tokens" as const, value: 150_000 },
      keep: { type: "tool_uses" as const, value: 8 },
      clear_at_least: { type: "input_tokens" as const, value: 40_000 },
      clear_tool_inputs: true,
    },
  ],
};

function claudeTools(tools: FunctionTool[]): BetaToolUnion[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? undefined,
    input_schema: toClaudeSchema(tool.parameters) as { type: "object" },
    strict: true,
  }));
}

async function loadMessages<M>(runId: number, conversation: string, length: number) {
  const rows = await db
    .select({ message: agentRunMessages.message })
    .from(agentRunMessages)
    .where(and(eq(agentRunMessages.runId, runId), eq(agentRunMessages.conversation, conversation), lt(agentRunMessages.seq, length)))
    .orderBy(asc(agentRunMessages.seq));
  return rows.map((row) => row.message as M);
}

/** Writes messages at their positions. A retried turn rewrites the same positions, so history never forks. */
async function saveMessages(runId: number, conversation: string, from: number, messages: (BetaMessageParam | ChatCompletionMessageParam)[]) {
  await db
    .insert(agentRunMessages)
    .values(messages.map((message, i) => ({ runId, conversation, seq: from + i, message })))
    .onConflictDoUpdate({
      target: [agentRunMessages.runId, agentRunMessages.conversation, agentRunMessages.seq],
      set: { message: sql`excluded.message` },
    });
}

async function claudeTurn<T>(input: TurnInput, state: Extract<LoopState, { provider: "anthropic" | "openrouter" }>): Promise<TurnOutcome<T>> {
  if (!input.apiKey) throw new NonRetriableError("The Anthropic API key was removed. Add it again in Settings → AI providers.");
  const anthropic = anthropicClient(input.apiKey);

  const history = await hydrateClaudeMessages(await loadMessages<BetaMessageParam>(state.runId, state.conversation, state.length), memoLoader(input.loadImage));
  // The last-turn instruction rides as a mid-conversation system message: it isn't stored, and the stage ends here.
  const messages: BetaMessageParam[] = input.forceFinish ? [...history, { role: "system", content: lastTurnMessage(input.finish.name) }] : history;
  const fallback = FALLBACK_MODELS.includes(state.model);

  const response = await anthropic.beta.messages
    .stream({
      model: state.model,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: input.instructions,
      messages,
      tools: claudeTools([...input.tools, input.finish]),
      tool_choice: { type: "auto" },
      // Caches the growing prefix (system, tools, history) so each turn pays full price only for what's new.
      cache_control: { type: "ephemeral" },
      output_config: { effort: claudeEffort(state.model, input.stage) },
      context_management: CLAUDE_CONTEXT_MANAGEMENT,
      betas: fallback ? [CONTEXT_EDITING_BETA, FALLBACK_BETA] : [CONTEXT_EDITING_BETA],
      ...(fallback ? { fallbacks: "default" as const } : {}),
    })
    .finalMessage();
  const costMicros = messageCostMicros(state.model, response.model, response.usage);

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    throw new NonRetriableError(`${modelInfo(state.model).label} declined this task${category ? ` (${category})` : ""}. Try another model for this agent.`);
  }
  if (response.stop_reason === "model_context_window_exceeded") {
    throw new NonRetriableError("The conversation outgrew the model's context window. Split the card into smaller ones.");
  }

  const truncated = response.stop_reason === "max_tokens";
  const toolUses = response.content.filter((block): block is Extract<BetaContentBlock, { type: "tool_use" }> => block.type === "tool_use");
  const finish = toolUses.find((block) => block.name === input.finish.name);
  if (finish && !truncated) {
    // Strict schema: the input already matches the finish tool's shape.
    return { state: { ...state, turn: state.turn + 1 }, costMicros, steps: [], result: finish.input as T };
  }

  // Every tool_use must be answered in the next user message, all results together.
  const results: BetaToolResultBlockParam[] = [];
  const steps: ToolStep[] = [];
  for (const block of toolUses) {
    const args = JSON.stringify(block.input ?? {});
    if (truncated) {
      results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: "Your output was cut off before this call was complete. Send it again, in smaller pieces if needed." });
      continue;
    }
    const { output, step, images } = await callTool(input.toolContext, input.tools, block.name, args);
    results.push({ type: "tool_result", tool_use_id: block.id, content: claudeToolResultContent(output, images) });
    steps.push(step);
  }
  // The turns-left note goes after the tool results, as a text block in the same message (append-only, cache-safe).
  const reply: BetaMessageParam = results.length
    ? { role: "user", content: input.notice ? [...results, { type: "text", text: input.notice }] : results }
    : { role: "user", content: input.notice ? `${NUDGE}\n\n${input.notice}` : NUDGE };

  // Stored verbatim (images as placeholders): thinking and fallback blocks must go back to the API unchanged.
  await saveMessages(state.runId, state.conversation, state.length, [{ role: "assistant", content: response.content }, reply]);
  return { state: { ...state, turn: state.turn + 1, length: state.length + 2 }, costMicros, steps, result: null };
}

// ── OpenRouter (Chat Completions) ──────────────────────────────────────────────

// Room for a whole file in one write_file call plus reasoning; hosts cap it lower where they must.
const OPENROUTER_MAX_TOKENS = 32_000;

function chatTools(tools: FunctionTool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description ?? undefined, parameters: tool.parameters ?? undefined, strict: tool.strict ?? undefined },
  }));
}

/** The assistant message to send back next turn: tool calls plus reasoning, unchanged (reasoning models need it). */
function assistantReply(message: OpenAI.Chat.Completions.ChatCompletionMessage): ChatCompletionMessageParam {
  // OpenRouter's extensions, absent from the SDK's types.
  const extra = message as { reasoning_details?: unknown; reasoning?: unknown };
  return {
    role: "assistant",
    content: message.content ?? "",
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    ...(extra.reasoning_details ? { reasoning_details: extra.reasoning_details } : extra.reasoning ? { reasoning: extra.reasoning } : {}),
  } as ChatCompletionMessageParam;
}

async function openRouterTurn<T>(input: TurnInput, state: Extract<LoopState, { provider: "anthropic" | "openrouter" }>): Promise<TurnOutcome<T>> {
  if (!input.apiKey) throw new NonRetriableError("The OpenRouter API key was removed. Add it again in Settings → AI providers.");
  const client = openRouterClient(input.apiKey);

  // Older turns fold into a digest once they pile up (lib/agent-context.ts); the stored conversation stays verbatim.
  const stored = await loadMessages<ChatCompletionMessageParam>(state.runId, state.conversation, state.length);
  const history = await hydrateChatMessages(compactChatHistory(stored).messages, memoLoader(input.loadImage));
  // The last-turn instruction isn't stored: the stage ends here. A user message, since hosts differ on late system ones.
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: input.instructions },
    ...history,
    ...(input.forceFinish ? [{ role: "user" as const, content: lastTurnMessage(input.finish.name) }] : []),
  ];
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    provider: typeof OPENROUTER_ROUTING;
    reasoning?: { effort: string };
  } = {
    model: state.model,
    messages,
    // Many hosts reject a forced tool, and models ignore the last-turn message (run 53: DeepSeek edited a file instead),
    // so the last turn offers only the finish tool.
    tools: chatTools(input.forceFinish ? [input.finish] : [...input.tools, input.finish]),
    tool_choice: "auto",
    max_tokens: OPENROUTER_MAX_TOKENS,
    provider: OPENROUTER_ROUTING,
    ...openRouterRequestParams(state.model, input.stage),
  };
  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await client.chat.completions.create(body, { timeout: OPENAI_TURN_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) throw new NonRetriableError("OpenRouter rejected the API key. Check it in Settings → AI providers.");
    if (error instanceof OpenAI.PermissionDeniedError) throw new NonRetriableError(`OpenRouter's moderation blocked ${modelInfo(state.model).label} on this task. Try another model for this agent.`);
    throw error;
  }
  const costMicros = completionCostMicros(state.model, response.usage);
  const choice = response.choices[0];
  if (!choice) throw new Error("OpenRouter returned no answer.");

  const truncated = choice.finish_reason === "length";
  const calls = (choice.message.tool_calls ?? []).filter((call) => call.type === "function");
  const finish = calls.find((call) => call.function.name === input.finish.name);
  const parsed = finish && !truncated ? parseFinishArguments(finish.function.arguments, input.finish) : null;
  if (parsed?.ok) return { state: { ...state, turn: state.turn + 1 }, costMicros, steps: [], result: parsed.value as T };

  // Every tool call must be answered, each with its own tool message.
  const replies: ChatCompletionMessageParam[] = [];
  const steps: ToolStep[] = [];
  const images: Parameters<typeof chatImagesMessage>[0] = [];
  for (const call of calls) {
    const { name, arguments: args } = call.function;
    let output: string;
    if (truncated) output = "Your output was cut off before this call was complete. Send it again, in smaller pieces if needed.";
    else if (call === finish && parsed && !parsed.ok) output = parsed.error;
    else {
      const called = await callTool(input.toolContext, input.tools, name, args);
      output = called.output;
      steps.push(called.step);
      const label = called.step.tool === "browse_preview" ? `screenshot of ${called.step.target ?? "the preview"}` : (called.step.target ?? "a reference");
      called.images.forEach((image, i) => images.push({ image, name: called.images.length > 1 ? `${label} (${i === 0 ? "desktop" : "mobile"})` : label }));
    }
    replies.push({ role: "tool", tool_call_id: call.id, content: output });
  }
  // Tool messages carry text only: this turn's images follow them in one user message, with the turns-left note.
  const imagesMessage = chatImagesMessage(images);
  if (imagesMessage && input.notice && Array.isArray(imagesMessage.content)) imagesMessage.content.push({ type: "text", text: input.notice });
  if (imagesMessage) replies.push(imagesMessage);
  else if (input.notice && replies.length) replies.push({ role: "user", content: input.notice });
  if (!replies.length) replies.push({ role: "user", content: input.notice ? `${NUDGE}\n\n${input.notice}` : NUDGE });

  const turnMessages = [assistantReply(choice.message), ...replies];
  await saveMessages(state.runId, state.conversation, state.length, turnMessages);
  return { state: { ...state, turn: state.turn + 1, length: state.length + turnMessages.length }, costMicros, steps, result: null };
}
