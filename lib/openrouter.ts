import "server-only";

import OpenAI from "openai";
import type { FunctionTool } from "openai/resources/responses/responses";

import { MICROS_PER_USD, type ModelPricing } from "@/lib/agent-config";

/**
 * OpenRouter: one key and one bill for other companies' models, over the OpenAI-compatible Chat Completions API
 * (its Responses API is stateless, so it buys nothing over Chat Completions).
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Client for one workspace's key (lib/ai-keys.ts). Clients are cheap; keys differ per workspace, so none is shared. */
export function openRouterClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    maxRetries: 2,
    timeout: 60_000,
    // Attribution on OpenRouter's side (optional): lets the account's activity page name the app.
    defaultHeaders: { "X-OpenRouter-Title": "TechTeam" },
  });
}

/**
 * Where OpenRouter may send our requests. A model is served by many hosts; these rules keep the repository's code
 * away from hosts that keep or train on it, skip hosts that drop tools or strict schemas (`require_parameters`), and
 * skip 4-bit quantized copies, which are cheaper but noticeably worse at long tool use.
 */
export const OPENROUTER_ROUTING = {
  data_collection: "deny",
  require_parameters: true,
  quantizations: ["fp8", "fp16", "bf16", "fp32", "unknown"],
} as const;

type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  /** OpenRouter's extension: what the request really cost, in USD (credits). */
  cost?: number | null;
};

/**
 * Cost of one completion in micro-dollars: the cost OpenRouter reports (hosts differ in price), else an estimate
 * from the model's listed price in the catalog (0 without one).
 */
export function completionCostMicros(pricing: ModelPricing | null, usage: ChatUsage | null | undefined) {
  if (!usage) return 0;
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) return Math.round(usage.cost * MICROS_PER_USD);
  if (!pricing) return 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, usage.prompt_tokens - cached);
  const usd = (uncached * pricing.input + cached * pricing.cachedInput + usage.completion_tokens * pricing.output) / 1_000_000;
  return Math.round(usd * MICROS_PER_USD);
}

// Fields a finish call may leave out, with what stands in: a stage never fails over them (an approval over its lessons).
const FINISH_DEFAULTS: Record<string, unknown> = { lessons: [] };

/** The finish call's result, or why it can't be used: hosts don't all enforce strict schemas, so it's checked here. */
export function parseFinishArguments(raw: string, finish: FunctionTool): { ok: true; value: unknown } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: `Error: the arguments for ${finish.name} were not valid JSON. Call it again with valid JSON.` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: `Error: ${finish.name} takes a JSON object. Call it again.` };
  }
  const required = Array.isArray(finish.parameters?.required) ? (finish.parameters.required as string[]) : [];
  const absent = required.filter((field) => !(field in value));
  const missing = absent.filter((field) => !(field in FINISH_DEFAULTS));
  if (missing.length) return { ok: false, error: `Error: ${finish.name} is missing ${missing.join(", ")}. Call it again with every field.` };
  return { ok: true, value: { ...Object.fromEntries(absent.map((field) => [field, FINISH_DEFAULTS[field]])), ...value } };
}

/** The `metadata.limit_source` of an OpenRouter 402, when it has one. */
function limitSource(error: InstanceType<typeof OpenAI.APIError>) {
  const body = error.error;
  if (typeof body !== "object" || body === null || !("metadata" in body)) return null;
  const metadata = body.metadata;
  if (typeof metadata !== "object" || metadata === null || !("limit_source" in metadata)) return null;
  return typeof metadata.limit_source === "string" ? metadata.limit_source : null;
}

/**
 * True when OpenRouter refused for lack of credit (the balance, or the key's own limit). Its in-flight budget also
 * answers 402, but that clears in seconds, so it's left to the step's retries.
 */
export function isOpenRouterOutOfCredit(error: unknown) {
  return error instanceof OpenAI.APIError && error.status === 402 && limitSource(error) !== "openrouter_in_flight_budget";
}

/** One message for users when OpenRouter fails, without leaking API details. */
export function openRouterErrorMessage(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return "OpenRouter rejected the API key. Check it in Settings → AI providers.";
    if (isOpenRouterOutOfCredit(error)) return "OpenRouter is out of credit. Add credit, or move the agents to another company.";
    if (error.status === 403) return "OpenRouter's moderation blocked this request. Try another model for this agent.";
    if (error.status === 429) return "OpenRouter rate limit reached. Try again in a minute.";
    if (error.status === 503) return "No OpenRouter host can serve this model with tools and private data right now. Try another model.";
    if (error.status && error.status >= 500) return "OpenRouter or the model's host is having trouble right now. Try again shortly.";
  }
  console.error("[openrouter]", error);
  return "The AI request failed. Please try again.";
}

/**
 * Checks a key without spending: GET /key answers 401 for a key OpenRouter doesn't know. Throws on network errors
 * so the caller can tell "rejected" from "unreachable".
 */
export async function checkOpenRouterKey(apiKey: string): Promise<"ok" | "rejected"> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (response.status === 401 || response.status === 403) return "rejected";
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
  return "ok";
}
