import type { AgentStage } from "@/lib/agent-run-config";
import type { LibrarianJob } from "@/lib/memory-proposals";
import type { CatalogModel, Effort } from "@/lib/model-catalog-config";

export type { Effort };

/**
 * Per-request knobs for agent turns, by model and stage (lib/agent-loop.ts). A parameter goes only to a model known to
 * accept it: OpenRouter routes with `require_parameters`, so a parameter a model's hosts don't list would leave no host
 * to serve it, and the native APIs answer 400 to a value a model doesn't take (OpenAI's 400 on an optional knob retries
 * the turn without it).
 *
 * What a model takes comes from the model catalog (OpenRouter's /models): `reasoning.supported_efforts` for the effort
 * levels and `supported_parameters` for `verbosity`. MODEL_EFFORTS overrides the levels for models checked against
 * their provider's own docs. A model with `reasoning_effort` but no levels listed gets the conservative low / medium /
 * high; a model with neither gets no effort. `parallel_tool_calls` is never sent: parallel calls are on by default.
 */

/**
 * Effort values checked by hand, by route id (2026-11-20): OpenAI's model pages (`none` only on Terra and Luna) and
 * Anthropic's effort docs (low…max on the 5.5 models); OpenRouter's /models per model. null: never send one. Not a model
 * list: models missing here take what the catalog says.
 */
export const MODEL_EFFORTS: Record<string, readonly Effort[] | null> = {
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

/** The conservative levels for a model that takes `reasoning_effort` but lists none. */
export const DEFAULT_EFFORTS: readonly Effort[] = ["low", "medium", "high"];

/** What a model accepts per request. */
export type ModelKnobs = { efforts: readonly Effort[] | null; verbosity: boolean };

/** A model's knobs: MODEL_EFFORTS for a checked id, else the catalog's entry (undefined: unknown model, nothing sent). */
export function modelKnobs(id: string, model: Pick<CatalogModel, "parameters" | "efforts"> | undefined): ModelKnobs {
  const parameters = model?.parameters ?? [];
  const listed = model?.efforts ?? (parameters.includes("reasoning_effort") ? DEFAULT_EFFORTS : null);
  return { efforts: id in MODEL_EFFORTS ? MODEL_EFFORTS[id] : listed, verbosity: parameters.includes("verbosity") };
}

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
export function stageEffort(knobs: ModelKnobs, stage: AgentStage): Effort | null {
  const wanted = STAGE_EFFORT[stage];
  return wanted && knobs.efforts?.includes(wanted) ? wanted : null;
}

// Claude's effort before per-stage tuning: agentic coding and multi-step tool use do well at medium (the 5.5 models'
// cost-sensible setting; Sonnet 5.5 would otherwise default to high).
const CLAUDE_EFFORT = "medium" satisfies Effort;

/** OpenAI (Responses): stage effort, and short visible text outside development (reports, not code) where it's taken. */
export function openAIRequestParams(knobs: ModelKnobs, stage: AgentStage) {
  const effort = stageEffort(knobs, stage);
  return {
    ...(effort ? { reasoning: { effort } } : {}),
    ...(stage === "development" || !knobs.verbosity ? {} : { text: { verbosity: "low" as const } }),
  };
}

/**
 * Anthropic (Messages): output_config.effort, medium unless the stage asks for another one the model takes; null (send
 * none) for a model that takes no effort.
 */
export function claudeEffort(knobs: ModelKnobs, stage: AgentStage): Exclude<Effort, "none"> | null {
  const effort = stageEffort(knobs, stage);
  if (effort && effort !== "none") return effort;
  return knobs.efforts?.includes(CLAUDE_EFFORT) ? CLAUDE_EFFORT : null;
}

/** OpenRouter (Chat Completions): `reasoning.effort` when the stage asks for one the model lists. */
export function openRouterRequestParams(knobs: ModelKnobs, stage: AgentStage) {
  const effort = stageEffort(knobs, stage);
  return effort ? { reasoning: { effort } } : {};
}

/**
 * The librarian's one structured call (lib/librarian-run.ts). Learning from short signals is routine extraction: low
 * effort where the model lists it. A bootstrap reads a repository once: the model's usual setting.
 */
export const LIBRARIAN_EFFORT: Record<LibrarianJob, Effort | null> = { learn: "low", bootstrap: null };

/** The effort to request from OpenAI or OpenRouter for a librarian job, or null to send none. */
export function librarianEffort(knobs: ModelKnobs, job: LibrarianJob): Effort | null {
  const wanted = LIBRARIAN_EFFORT[job];
  return wanted && knobs.efforts?.includes(wanted) ? wanted : null;
}

/** The same for Claude's output_config.effort: medium unless the job asks for another one the model takes. */
export function librarianClaudeEffort(knobs: ModelKnobs, job: LibrarianJob): Exclude<Effort, "none"> | null {
  const effort = librarianEffort(knobs, job);
  if (effort && effort !== "none") return effort;
  return knobs.efforts?.includes(CLAUDE_EFFORT) ? CLAUDE_EFFORT : null;
}
