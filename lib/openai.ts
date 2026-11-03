import "server-only";

import OpenAI from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses";

import { AGENT_MODELS, MICROS_PER_USD, type AgentModelId } from "@/lib/agent-config";

/** Model for configuration helpers (writing instructions, trust reviews): strong writing at a moderate price. */
export const CONFIG_MODEL: AgentModelId = "gpt-6.1-sol";

let client: OpenAI | null = null;

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Shared client, or null when OPENAI_API_KEY isn't set (AI features then degrade instead of failing). */
export function getOpenAI() {
  if (!isOpenAIConfigured()) return null;
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

/** Cost of one response in micro-dollars, from the token usage OpenAI reports and AGENT_MODELS pricing. */
export function responseCostMicros(model: AgentModelId, usage: ResponseUsage | null | undefined) {
  if (!usage) return 0;
  const { pricing } = AGENT_MODELS.find((m) => m.id === model)!;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached - cacheWrite);
  // Prices are per 1M tokens, so tokens × $/1M × 1e6 micros/$ / 1e6 = tokens × $/1M micros.
  const usd =
    (uncached * pricing.input + cached * pricing.cachedInput + cacheWrite * pricing.cacheWrite + usage.output_tokens * pricing.output) /
    1_000_000;
  return Math.round(usd * MICROS_PER_USD);
}

/** One message for users when OpenAI fails, without leaking API details. */
export function openAIErrorMessage(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return "OpenAI rejected the API key. Check OPENAI_API_KEY.";
    if (error.status === 429) return "OpenAI rate limit or quota reached. Try again in a minute.";
    if (error.status && error.status >= 500) return "OpenAI is having trouble right now. Try again shortly.";
  }
  console.error("[openai]", error);
  return "The AI request failed. Please try again.";
}
