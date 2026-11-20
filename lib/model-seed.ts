import { buildCatalog, type CatalogEntry, type Effort, type ModelPricing } from "@/lib/model-catalog-config";

/**
 * The built-in seed: the models TechTeam offered before the live catalog (lib/model-catalog.ts), in the catalog's
 * shape. Used only until the first successful fetch (first run offline, simulated mode, unit tests), and to price and
 * name an agent's model that no stored row knows. Never extended: new models come from the catalog.
 * Prices and efforts as checked on 2026-11-20; release dates from OpenRouter's catalog (grok-build-0.1, no longer
 * listed: approximate).
 */

const API = ["tools", "structured_outputs", "reasoning", "reasoning_effort", "verbosity"];
const ROUTER = ["tools", "structured_outputs", "reasoning", "reasoning_effort"];

const ALL: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const WITH_NONE: Effort[] = ["none", ...ALL];

function seed(
  openRouterId: string,
  label: string,
  createdAt: string,
  vision: boolean,
  pricing: ModelPricing,
  efforts: Effort[] | null,
  parameters: string[] = efforts ? ROUTER : ["tools", "structured_outputs"]
): CatalogEntry {
  return { openRouterId, label, createdAt, expiresAt: null, vision, contextLength: null, pricing, parameters, efforts, listed: true };
}

export const SEED_ENTRIES: readonly CatalogEntry[] = [
  seed("openai/gpt-6-astra", "GPT-6 Astra", "2026-09-04T20:13:58Z", true, { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 }, ALL, API),
  seed("openai/gpt-6.1-sol", "GPT-6.1 Sol", "2026-09-29T17:28:02Z", true, { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 }, ALL, API),
  seed("openai/gpt-6.1-terra", "GPT-6.1 Terra", "2026-10-26T18:13:29Z", true, { input: 1, cachedInput: 0.05, cacheWrite: 1.25, output: 5 }, WITH_NONE, API),
  seed("openai/gpt-6-luna", "GPT-6 Luna", "2026-09-22T18:13:06Z", true, { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 }, WITH_NONE, API),
  seed("anthropic/claude-opus-5.5", "Claude Opus 5.5", "2026-09-22T16:32:12Z", true, { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 }, ALL, API),
  seed("anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5", "2026-09-28T18:04:46Z", true, { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 }, ALL, API),
  seed(
    "anthropic/claude-haiku-5.5",
    "Claude Haiku 5.5",
    "2026-10-07T18:31:23Z",
    true,
    { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5 } },
    ALL,
    API
  ),
  seed("google/gemini-4-argon", "Gemini 4 Argon", "2026-10-13T16:04:37Z", true, { input: 2, cachedInput: 0.1, cacheWrite: 0.1875, output: 10 }, ["low", "medium", "high"]),
  seed("x-ai/grok-4.7", "Grok 4.7", "2026-09-21T16:19:01Z", true, { input: 2, cachedInput: 0.5, cacheWrite: 2, output: 6 }, ["low", "medium", "high", "xhigh"]),
  seed("deepseek/deepseek-v4-pro-0813", "DeepSeek V4 Pro", "2026-08-12T15:42:44Z", false, { input: 0.111, cachedInput: 0.097, cacheWrite: 0.111, output: 4.44 }, ["none", "low", "high", "max"]),
  seed("z-ai/glm-5.3", "GLM 5.3", "2026-08-18T20:57:35Z", false, { input: 0.0699, cachedInput: 0.0689, cacheWrite: 0.0699, output: 1.4 }, ["low", "high", "max"]),
  seed("moonshotai/kimi-k3.1-pro", "Kimi K3.1 Pro", "2026-10-23T17:56:28Z", true, { input: 0.253, cachedInput: 0.18, cacheWrite: 0.253, output: 8.8 }, ["none", "low", "high", "max"]),
  seed("google/gemini-4-hydrogen", "Gemini 4 Hydrogen", "2026-11-12T18:01:00Z", true, { input: 1.5, cachedInput: 0.075, cacheWrite: 0.0833, output: 7.5 }, ["low", "medium", "high", "xhigh"]),
  seed("x-ai/grok-build-0.1", "Grok Build 0.1", "2026-08-28T00:00:00Z", true, { input: 1, cachedInput: 0.2, cacheWrite: 1, output: 2 }, null),
  seed("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "2026-09-10T06:21:25Z", true, { input: 0.3, cachedInput: 0.006, cacheWrite: 0.3, output: 1.2 }, ["none", "low", "high", "max"]),
  seed("z-ai/glm-5.3-flash", "GLM 5.3 Flash", "2026-08-26T13:59:01Z", true, { input: 0.15, cachedInput: 0.03, cacheWrite: 0.15, output: 0.5 }, ["low", "high", "max"]),
  seed("google/gemini-3.8-flash", "Gemini 3.8 Flash", "2026-09-02T15:14:16Z", true, { input: 0.825, cachedInput: 0.0825, cacheWrite: 0.0417, output: 4.125 }, ["low", "medium", "high"]),
];

/** The seed as a catalog: what the app runs on before the first fetch, and the last resort for a role default. */
export const SEED_CATALOG = buildCatalog(SEED_ENTRIES, { now: new Date("2026-11-20T00:00:00Z"), fetchedAt: null, source: "seed" });
