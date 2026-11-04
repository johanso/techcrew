import "server-only";

import OpenAI from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses";

import { AGENT_MODELS, MICROS_PER_USD, type AgentModelId } from "@/lib/agent-config";

/** Client for one workspace's key (lib/ai-keys.ts). Clients are cheap; keys differ per workspace, so none is shared. */
export function openAIClient(apiKey: string) {
  return new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
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

// Error codes OpenAI uses when the account can't pay for more requests (as opposed to a rate limit, which passes).
const OUT_OF_CREDIT_CODES = ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active"];

/** True when OpenAI refused because the account is out of credit or billing is off. Retrying won't help. */
export function isOpenAIOutOfCredit(error: unknown) {
  return error instanceof OpenAI.APIError && OUT_OF_CREDIT_CODES.includes(String(error.code ?? ""));
}

/** One message for users when OpenAI fails, without leaking API details. */
export function openAIErrorMessage(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return "OpenAI rejected the API key. Check it in Settings → AI providers.";
    if (isOpenAIOutOfCredit(error)) return "OpenAI is out of credit. Add credit, or switch provider in Settings.";
    if (error.status === 429) return "OpenAI rate limit or quota reached. Add credit, wait a minute, or switch provider in Settings.";
    if (error.status && error.status >= 500) return "OpenAI is having trouble right now. Try again shortly.";
  }
  console.error("[openai]", error);
  return "The AI request failed. Please try again.";
}
