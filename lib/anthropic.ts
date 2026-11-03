import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { AGENT_MODELS, MICROS_PER_USD, type AgentModelId } from "@/lib/agent-config";

/** Client for one workspace's key (lib/ai-keys.ts). Clients are cheap; keys differ per workspace, so none is shared. */
export function anthropicClient(apiKey: string) {
  return new Anthropic({ apiKey, maxRetries: 2 });
}

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

/**
 * Cost of one Messages response in micro-dollars. `servedBy` is the model that answered: with refusal fallbacks
 * it can differ from the one requested, and is priced at its own rates when we know them.
 */
export function messageCostMicros(requested: AgentModelId, servedBy: string, usage: TokenUsage) {
  const model = AGENT_MODELS.find((m) => m.id === servedBy) ?? AGENT_MODELS.find((m) => m.id === requested)!;
  const pricing = model.pricing;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
  const long = "longPrompt" in pricing && promptTokens > pricing.longPrompt.aboveTokens ? pricing.longPrompt : null;
  // Cache rates scale with the base input rate, so a long-prompt request scales them too.
  const scale = long ? long.input / pricing.input : 1;
  const usd =
    (usage.input_tokens * (long?.input ?? pricing.input) +
      cacheRead * pricing.cachedInput * scale +
      cacheWrite * pricing.cacheWrite * scale +
      usage.output_tokens * (long?.output ?? pricing.output)) /
    1_000_000;
  return Math.round(usd * MICROS_PER_USD);
}

/** One message for users when Anthropic fails, without leaking API details. */
export function anthropicErrorMessage(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key. Check it in Settings → AI providers.";
  if (error instanceof Anthropic.RateLimitError) return "Anthropic rate limit reached. Try again in a minute.";
  // Out of credit comes back as a 400 whose message says so.
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    return "Anthropic credit balance is too low. Add credit or switch provider in Settings.";
  }
  if (error instanceof Anthropic.InternalServerError) return "Anthropic is having trouble right now. Try again shortly.";
  console.error("[anthropic]", error);
  return "The AI request failed. Please try again.";
}

/**
 * Strict tool schemas on Anthropic don't list `type: [..., "null"]` among supported forms; the equivalent
 * `anyOf` is. Converts our OpenAI-style schemas (recursively) so one definition serves both providers.
 */
export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = toClaudeSchema(value);
  if (Array.isArray(out.type)) {
    const { type, description, ...rest } = out;
    return { ...(description ? { description } : {}), anyOf: (type as string[]).map((t) => ({ ...rest, type: t })) };
  }
  return out;
}
