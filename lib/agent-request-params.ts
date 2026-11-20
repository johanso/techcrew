import type { AgentModelId } from "@/lib/agent-config";
import type { AgentStage } from "@/lib/agent-run-config";

/**
 * Per-request knobs for agent turns, by model and stage (lib/agent-loop.ts). A parameter goes only to a model known to
 * accept it: OpenRouter routes with `require_parameters`, so a parameter a model's hosts don't list would leave no host
 * to serve it, and the native APIs answer 400 to a value a model doesn't take. Unknown model: nothing is sent.
 *
 * Sources (2026-11-20): OpenAI's model pages and deployment checklist (`reasoning.effort` low…max on every GPT-6 model,
 * `none` only on Terra and Luna; `text.verbosity` low/medium/high, default medium); Anthropic's effort docs (Opus,
 * Sonnet and Haiku 5.5: low…max); OpenRouter's /models `supported_parameters` and `reasoning.supported_efforts` per
 * model. No OpenRouter model of ours lists `verbosity`; `parallel_tool_calls` is listed only by some, and parallel calls
 * are on by default everywhere, so neither is sent.
 */

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/** Effort values each model accepts. null: unknown, never send one. */
export const MODEL_EFFORTS: Record<AgentModelId, readonly Effort[] | null> = {
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6.1-terra": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-haiku-5-5": ["low", "medium", "high", "xhigh", "max"],
  "google/gemini-4-argon": ["low", "medium", "high"],
  "x-ai/grok-4.7": ["low", "medium", "high", "xhigh"],
  "deepseek/deepseek-v4-pro-0813": ["none", "low", "high", "max"],
  "z-ai/glm-5.3": ["low", "high", "max"],
  "moonshotai/kimi-k3.1-pro": ["none", "low", "high", "max"],
  "google/gemini-4-hydrogen": ["low", "medium", "high", "xhigh"],
  // No longer listed by OpenRouter's /models (2026-11-20): its parameters can't be checked.
  "x-ai/grok-build-0.1": null,
  "deepseek/deepseek-v4.1-flash": ["none", "low", "high", "max"],
  "z-ai/glm-5.3-flash": ["low", "high", "max"],
  "google/gemini-3.8-flash": ["low", "medium", "high"],
};

/**
 * Effort per stage where it differs from the model's usual setting (null: leave it). The Lead weighs two reports and a
 * measured diff into one decision: low effort means fewer, more consolidated calls, and the risk floor and the reviews
 * guard the outcome. The stages that read and write code keep their effort: quality there is what the card pays for.
 */
export const STAGE_EFFORT: Record<AgentStage, Effort | null> = {
  analysis: null,
  development: null,
  review: null,
  security: null,
  approval: "low",
  testing: null,
};

/** The effort to request for this stage on this model, or null to send none (the stage keeps the default, or the model doesn't take it). */
export function stageEffort(model: AgentModelId, stage: AgentStage): Effort | null {
  const wanted = STAGE_EFFORT[stage];
  return wanted && MODEL_EFFORTS[model]?.includes(wanted) ? wanted : null;
}

// Claude's effort before per-stage tuning: agentic coding and multi-step tool use do well at medium (the 5.5 models'
// cost-sensible setting; Sonnet 5.5 would otherwise default to high).
const CLAUDE_EFFORT = "medium" satisfies Effort;

/** OpenAI (Responses): stage effort, and short visible text outside development (reports, not code). */
export function openAIRequestParams(model: AgentModelId, stage: AgentStage) {
  const effort = stageEffort(model, stage);
  return {
    ...(effort ? { reasoning: { effort } } : {}),
    ...(stage === "development" ? {} : { text: { verbosity: "low" as const } }),
  };
}

/** Anthropic (Messages): output_config.effort, medium unless the stage asks for another one the model takes. */
export function claudeEffort(model: AgentModelId, stage: AgentStage): Exclude<Effort, "none"> {
  const effort = stageEffort(model, stage);
  return effort && effort !== "none" ? effort : CLAUDE_EFFORT;
}

/** OpenRouter (Chat Completions): `reasoning.effort` when the stage asks for one the model lists. */
export function openRouterRequestParams(model: AgentModelId, stage: AgentStage) {
  const effort = stageEffort(model, stage);
  return effort ? { reasoning: { effort } } : {};
}
