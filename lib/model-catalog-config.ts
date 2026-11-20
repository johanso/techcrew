import type { AgentProvider } from "@/lib/agent-config";

/**
 * The model catalog's pure, client-safe rules (lib/model-catalog.ts keeps it in the database). Every model an agent can
 * pick comes from OpenRouter's public `GET /api/v1/models` catalog, which lists Anthropic's and OpenAI's own models
 * next to the other companies': one source for every route (docs/model-catalog-plan.md).
 *
 * - Route ids: Anthropic's API and Claude Code take `claude-opus-5-5` for `anthropic/claude-opus-5.5`, OpenAI's API
 *   `gpt-6.1-sol` for `openai/gpt-6.1-sol`, OpenRouter its own id. `agents.model` stores the route id.
 * - Eligible: a model of a company TechTeam offers, with tools and structured outputs (every stage ends on a strict
 *   finish tool), text out, not a variant (`:batch`, `:free` …), preview, mode twin or expired.
 * - Current: the newest model of each family (`claude-opus`, `gpt-sol`, `deepseek-pro` …) whose family shipped within
 *   CURRENT_WINDOW_DAYS of its company's newest model. Only current models are offered; an agent keeps its model when
 *   it stops being current ("older").
 * - Tier: each company's current models ranked by output price, top third flagship, bottom third fast.
 */

export const MODEL_TIERS = ["flagship", "balanced", "fast"] as const;
/** Where a model sits on quality vs price. Moving an agent to another company keeps its tier (closestModel). */
export type ModelTier = (typeof MODEL_TIERS)[number];

export const TIER_LABEL: Record<ModelTier, string> = { flagship: "Flagship", balanced: "Balanced", fast: "Fast" };

/**
 * USD per 1M tokens (the catalog's per-token strings × 1e6). `cacheWrite` is the 5-minute cache write; `longPrompt` is
 * the higher rate a model charges for the whole request above that many input tokens. OpenRouter's real cost comes
 * back with every response and is what's logged for its models.
 */
export type ModelPricing = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  longPrompt?: { aboveTokens: number; input: number; output: number };
};

export const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

const isEffort = (value: unknown): value is Effort => typeof value === "string" && (EFFORTS as readonly string[]).includes(value);

/** One model as stored (`model_catalog`): what the catalog said about it the last time it was listed. */
export type CatalogEntry = {
  openRouterId: string;
  /** The catalog's name without its company prefix ("Claude Opus 5.5"). */
  label: string;
  /** When the model came out (the catalog's `created`), ISO. */
  createdAt: string;
  expiresAt: string | null;
  vision: boolean;
  contextLength: number | null;
  pricing: ModelPricing;
  /** The catalog's `supported_parameters` (tools, structured_outputs, reasoning_effort, verbosity …). */
  parameters: string[];
  /** The catalog's `reasoning.supported_efforts`, in our vocabulary; null when it lists none. */
  efforts: Effort[] | null;
  /** In the latest successful fetch. A model that left the catalog keeps its row (price, label) but isn't current. */
  listed: boolean;
};

/** A model as the app uses it: the stored entry plus its route, company and place in the lineup. */
export type CatalogModel = Omit<CatalogEntry, "listed"> & {
  /** The route id: what `agents.model` stores and the provider's API takes. */
  id: string;
  provider: AgentProvider;
  maker: string;
  family: string;
  tier: ModelTier;
  /** Offered in the picker. False: an older model, kept because an agent may still use it. */
  current: boolean;
};

export type ModelCatalog = {
  models: CatalogModel[];
  /** The latest successful fetch (ISO), null while the app runs on the built-in seed. */
  fetchedAt: string | null;
  source: "stored" | "seed";
};

// ── Companies and route ids ────────────────────────────────────────────────────

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** The companies offered through OpenRouter, in picker order (OpenRouter id prefix → name). */
export const OPENROUTER_MAKERS = [
  { prefix: "google", label: "Google" },
  { prefix: "x-ai", label: "xAI" },
  { prefix: "deepseek", label: "DeepSeek" },
  { prefix: "z-ai", label: "Z.ai" },
  { prefix: "moonshotai", label: "Moonshot" },
] as const;

/**
 * Where role defaults look first on OpenRouter, which resells several companies: DeepSeek (strong and cheap for the
 * pipeline, the owner's pick). Another company's model of the tier only when DeepSeek has none.
 */
export const OPENROUTER_DEFAULT_MAKER = "DeepSeek";

const PROVIDER_ORDER: AgentProvider[] = ["openai", "anthropic", "openrouter"];

/** The route a catalog model takes, or null when TechTeam doesn't offer its company. */
export function routeOf(openRouterId: string): { id: string; provider: AgentProvider; maker: string } | null {
  const slash = openRouterId.indexOf("/");
  if (slash <= 0) return null;
  const prefix = openRouterId.slice(0, slash);
  const name = openRouterId.slice(slash + 1);
  if (!name) return null;
  // Anthropic's ids use dashes where the catalog has dots: claude-opus-5.5 → claude-opus-5-5.
  if (prefix === "anthropic") return name.startsWith("claude-") ? { id: name.replace(/\./g, "-"), provider: "anthropic", maker: "Anthropic" } : null;
  if (prefix === "openai") return name.startsWith("gpt-") ? { id: name, provider: "openai", maker: "OpenAI" } : null;
  const maker = OPENROUTER_MAKERS.find((m) => m.prefix === prefix);
  return maker ? { id: openRouterId, provider: "openrouter", maker: maker.label } : null;
}

/** The catalog id of a route id (the reverse of routeOf), or null when it can't be one. */
export function openRouterIdOf(id: string): string | null {
  const provider = modelProvider(id);
  if (provider === "openrouter") return id;
  // Version dots came out as dashes; a date (claude-opus-4-20250514) isn't a version.
  if (provider === "anthropic") return `anthropic/${id.replace(/(\d)-(\d{1,2})(?=-|$)/g, "$1.$2")}`;
  if (provider === "openai") return `openai/${id}`;
  return null;
}

const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{1,127}$/i;

/** The company behind a route id, from its shape alone (no catalog needed): claude-… Anthropic, gpt-… OpenAI, a/b OpenRouter. */
export function modelProvider(id: string): AgentProvider | null {
  if (!MODEL_ID.test(id)) return null;
  if (id.includes("/")) return /^[^/]+\/[^/]+$/.test(id) ? "openrouter" : null;
  if (id.startsWith("claude-")) return "anthropic";
  if (id.startsWith("gpt-")) return "openai";
  return null;
}

/** A string shaped like a route id of a company TechTeam offers (whether the catalog lists it is another question). */
export function isModelId(value: unknown): value is string {
  return typeof value === "string" && modelProvider(value) !== null;
}

/** A version-like token: 5, 5.5, v4, k3.1, 4o, 0813, a4b. */
const VERSION_TOKEN = /^[a-z]?\d+(\.\d+)*[a-z]?$/;

/** A model's family: its id without version tokens (anthropic/claude-opus-5.5 → anthropic/claude-opus). */
export function modelFamily(openRouterId: string) {
  const [prefix, name = ""] = openRouterId.split("/");
  const kept = name.split("-").filter((token) => !VERSION_TOKEN.test(token));
  return `${prefix}/${kept.length ? kept.join("-") : name}`;
}

// ── Parsing the catalog ────────────────────────────────────────────────────────

/** How long a family stays current after its company's newest release (it was superseded, or the line stopped). */
export const CURRENT_WINDOW_DAYS = 183;
/** Refresh when the stored catalog is older than this. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const NOT_RELEASED = /(^|-)(preview|exp|experimental|beta|alpha)(-|$)/;

type RawModel = {
  id: string;
  name: string;
  created: number;
  expirationDate: string | null;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  pricing: ModelPricing;
  parameters: string[];
  efforts: Effort[] | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** A per-token price string → USD per 1M tokens, without float noise (0.0000001 → 0.1). Null when it isn't one. */
export function perMillion(value: unknown): number | null {
  const perToken = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  return Math.round(perToken * 1e6 * 1e6) / 1e6;
}

/** The catalog's `pricing` → ModelPricing; null without a prompt and completion price. */
export function parsePricing(raw: unknown): ModelPricing | null {
  if (!isRecord(raw)) return null;
  const input = perMillion(raw.prompt);
  const output = perMillion(raw.completion);
  if (input === null || output === null) return null;
  const pricing: ModelPricing = {
    input,
    cachedInput: perMillion(raw.input_cache_read) ?? input,
    cacheWrite: perMillion(raw.input_cache_write) ?? input,
    output,
  };
  // Long prompts: the first override by prompt size (OpenAI above 272K tokens, Haiku above 100K).
  const long = Array.isArray(raw.overrides) ? raw.overrides.find((o) => isRecord(o) && typeof o.min_prompt_tokens === "number") : undefined;
  if (isRecord(long)) {
    const longInput = perMillion(long.prompt);
    const longOutput = perMillion(long.completion);
    if (longInput !== null && longOutput !== null) pricing.longPrompt = { aboveTokens: long.min_prompt_tokens as number, input: longInput, output: longOutput };
  }
  return pricing;
}

function parseModel(raw: unknown): RawModel | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.created !== "number") return null;
  const pricing = parsePricing(raw.pricing);
  if (!pricing) return null;
  const architecture = isRecord(raw.architecture) ? raw.architecture : {};
  const reasoning = isRecord(raw.reasoning) ? raw.reasoning : {};
  const efforts = strings(reasoning.supported_efforts).filter(isEffort);
  return {
    id: raw.id,
    name: raw.name,
    created: raw.created,
    expirationDate: typeof raw.expiration_date === "string" ? raw.expiration_date : null,
    contextLength: typeof raw.context_length === "number" ? raw.context_length : null,
    inputModalities: strings(architecture.input_modalities),
    outputModalities: strings(architecture.output_modalities),
    pricing,
    parameters: strings(raw.supported_parameters),
    // In the order we know them (low … max), not the catalog's.
    efforts: efforts.length ? EFFORTS.filter((e) => efforts.includes(e)) : null,
  };
}

/** "Anthropic: Claude Opus 5.5" → "Claude Opus 5.5". */
export function modelLabel(name: string) {
  const colon = name.indexOf(": ");
  return (colon >= 0 ? name.slice(colon + 2) : name).trim();
}

const expired = (expiresAt: string | null, now: Date) => expiresAt !== null && new Date(expiresAt).getTime() <= now.getTime();

/** Why the pipeline can't use a catalog model, or null when it can (tested on the fixture). */
export function ineligibleReason(model: RawModel, now: Date): string | null {
  if (model.id.includes(":")) return "variant";
  if (!routeOf(model.id)) return "company";
  if (NOT_RELEASED.test(model.id.split("/")[1] ?? "")) return "preview";
  if (model.outputModalities.length && (model.outputModalities.length !== 1 || model.outputModalities[0] !== "text")) return "output";
  if (!model.parameters.includes("tools") || !model.parameters.includes("structured_outputs")) return "tools";
  if (expired(model.expirationDate, now)) return "expired";
  return null;
}

/**
 * The response of `GET /api/v1/models` → the models TechTeam can offer, as stored. Unknown shapes are skipped, never
 * thrown on. A mode twin (OpenRouter's `gpt-6.2-sol-pro`: the same model at the same price in another reasoning mode,
 * which the provider's own API doesn't have) is left out next to its base model.
 */
export function parseCatalogResponse(body: unknown, now: Date): CatalogEntry[] {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const models = data.map(parseModel).filter((m): m is RawModel => m !== null && ineligibleReason(m, now) === null);
  const byId = new Map(models.map((m) => [m.id, m]));
  return models
    .filter((m) => {
      if (!m.id.endsWith("-pro")) return true;
      const base = byId.get(m.id.slice(0, -"-pro".length));
      return !(base && base.pricing.input === m.pricing.input && base.pricing.output === m.pricing.output);
    })
    .map((m) => ({
      openRouterId: m.id,
      label: modelLabel(m.name),
      createdAt: new Date(m.created * 1000).toISOString(),
      expiresAt: m.expirationDate ? new Date(m.expirationDate).toISOString() : null,
      vision: m.inputModalities.includes("image"),
      contextLength: m.contextLength,
      pricing: m.pricing,
      parameters: m.parameters,
      efforts: m.efforts,
      listed: true,
    }));
}

// ── Building the lineup ────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (iso: string) => new Date(iso).getTime();
const makerRank = (provider: AgentProvider, maker: string) =>
  provider === "openrouter" ? OPENROUTER_MAKERS.findIndex((m) => m.label === maker) : 0;
// Pricier first, then newer, then by id: a stable order for tiers and pickers.
const byPrice = (a: CatalogModel, b: CatalogModel) =>
  b.pricing.output - a.pricing.output || b.pricing.input - a.pricing.input || time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id);

/** Tier by rank among n models sorted pricier first: the top third flagship, the bottom third fast; a lone model balanced. */
export function tierAt(index: number, count: number): ModelTier {
  if (count <= 1) return "balanced";
  return MODEL_TIERS[Math.min(2, Math.floor((3 * index) / count))];
}

const priceDistance = (a: ModelPricing, b: ModelPricing) => Math.abs(Math.log((a.output + 1e-6) / (b.output + 1e-6)));

/**
 * Stored entries → the catalog the app uses: route ids, current models, tiers. Older models (not current) keep their
 * row so an agent on one keeps its label, price and tier (the tier of the current model nearest in price).
 */
export function buildCatalog(entries: readonly CatalogEntry[], options: { now: Date; fetchedAt: string | null; source: ModelCatalog["source"] }): ModelCatalog {
  const models: CatalogModel[] = [];
  const listed = new Map<string, boolean>();
  for (const { listed: isListed, ...entry } of entries) {
    const route = routeOf(entry.openRouterId);
    if (!route || listed.has(route.id)) continue;
    listed.set(route.id, isListed && !expired(entry.expiresAt, options.now));
    models.push({ ...entry, ...route, family: modelFamily(entry.openRouterId), tier: "balanced", current: false });
  }

  const candidates = models.filter((m) => listed.get(m.id));
  const newestOfFamily = new Map<string, CatalogModel>();
  const newestOfMaker = new Map<string, number>();
  for (const m of candidates) {
    const best = newestOfFamily.get(m.family);
    if (!best || time(m.createdAt) > time(best.createdAt) || (time(m.createdAt) === time(best.createdAt) && m.id < best.id)) newestOfFamily.set(m.family, m);
    newestOfMaker.set(m.maker, Math.max(newestOfMaker.get(m.maker) ?? 0, time(m.createdAt)));
  }
  for (const m of newestOfFamily.values()) {
    m.current = time(m.createdAt) >= (newestOfMaker.get(m.maker) ?? 0) - CURRENT_WINDOW_DAYS * DAY_MS;
  }

  for (const provider of PROVIDER_ORDER) {
    const current = models.filter((m) => m.provider === provider && m.current).sort(byPrice);
    current.forEach((m, index) => (m.tier = tierAt(index, current.length)));
    for (const m of models.filter((o) => o.provider === provider && !o.current)) {
      const nearest = [...current].sort((a, b) => priceDistance(a.pricing, m.pricing) - priceDistance(b.pricing, m.pricing))[0];
      m.tier = nearest?.tier ?? "balanced";
    }
  }

  models.sort(
    (a, b) =>
      PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
      makerRank(a.provider, a.maker) - makerRank(b.provider, b.maker) ||
      Number(b.current) - Number(a.current) ||
      byPrice(a, b)
  );
  return { models, fetchedAt: options.fetchedAt, source: options.source };
}

/**
 * The entries to build from: the stored ones, else the built-in seed (first run offline). Stored rows win; seed models
 * missing from them fill in as not listed, so an agent on a seed model keeps its price and label.
 */
export function catalogEntries(stored: readonly CatalogEntry[], seed: readonly CatalogEntry[]) {
  if (!stored.length) return { entries: seed, source: "seed" as const };
  const known = new Set(stored.map((e) => e.openRouterId));
  return { entries: [...stored, ...seed.filter((e) => !known.has(e.openRouterId)).map((e) => ({ ...e, listed: false }))], source: "stored" as const };
}

/** Whether the stored catalog should be fetched again. */
export function catalogStale(fetchedAt: string | null, now: Date) {
  return !fetchedAt || now.getTime() - time(fetchedAt) > CATALOG_MAX_AGE_MS;
}

// ── Lookups ────────────────────────────────────────────────────────────────────

export function findModel(catalog: ModelCatalog, id: string): CatalogModel | undefined {
  return catalog.models.find((m) => m.id === id);
}

/** Whether `id` is a model the catalog knows (current or older). */
export function isCatalogModel(catalog: ModelCatalog, id: unknown): id is string {
  return typeof id === "string" && catalog.models.some((m) => m.id === id);
}

/** The current models of a company, in picker order (maker, then pricier first). */
export function currentModels(catalog: ModelCatalog, provider: AgentProvider) {
  return catalog.models.filter((m) => m.provider === provider && m.current);
}

/**
 * What the model picker lists for a company: its current models, plus `keep` (the agent's model) when it's on that
 * company but no longer current. A model the catalog doesn't know at all comes back as a bare entry so the picker can
 * still show it.
 */
export function pickerModels(catalog: ModelCatalog, provider: AgentProvider, keep?: string): CatalogModel[] {
  const models = currentModels(catalog, provider);
  if (!keep || modelProvider(keep) !== provider || models.some((m) => m.id === keep)) return models;
  return [...models, findModel(catalog, keep) ?? unknownModel(keep)];
}

/**
 * The catalog the AI Team page sends to the browser: current models plus `keep` (the team's models, current or not;
 * one the catalog doesn't know comes as a bare entry), without the other older ones.
 */
export function pickerCatalog(catalog: ModelCatalog, keep: readonly string[]): ModelCatalog {
  const models = catalog.models.filter((m) => m.current || keep.includes(m.id));
  const unknown = [...new Set(keep)].filter((id) => modelProvider(id) && !models.some((m) => m.id === id)).map(unknownModel);
  return { ...catalog, models: [...models, ...unknown] };
}

/** A stand-in for a model the catalog doesn't know (it left before the first fetch): no price, no vision. */
export function unknownModel(id: string): CatalogModel {
  const provider = modelProvider(id) ?? "openrouter";
  return {
    id,
    openRouterId: openRouterIdOf(id) ?? id,
    provider,
    maker: routeOf(openRouterIdOf(id) ?? "")?.maker ?? "Other",
    label: id,
    family: modelFamily(openRouterIdOf(id) ?? id),
    createdAt: new Date(0).toISOString(),
    expiresAt: null,
    vision: false,
    contextLength: null,
    pricing: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
    parameters: [],
    efforts: null,
    tier: "balanced",
    current: false,
  };
}

/** The display name of a route id: the catalog's label, else the id itself. */
export function catalogLabel(catalog: ModelCatalog, id: string) {
  return findModel(catalog, id)?.label ?? id;
}

/** The companies behind a list of models, in list order (OpenRouter: Google, xAI, DeepSeek …). */
export function makersOf(models: readonly CatalogModel[]) {
  return [...new Set(models.map((m) => m.maker))];
}

// A company may lack a tier (two current models: no fast one): try the neighbors, the nearer one first.
const TIER_ORDER: Record<ModelTier, ModelTier[]> = {
  flagship: ["flagship", "balanced", "fast"],
  balanced: ["balanced", "flagship", "fast"],
  fast: ["fast", "balanced", "flagship"],
};

/**
 * `model`'s closest equivalent among `provider`'s current models: the same tier, and within it the model nearest in
 * output price; when the company has nothing in that tier, the model nearest in price. An unknown model counts as
 * balanced. Null only when the company has no current model.
 */
export function closestModel(catalog: ModelCatalog, model: string, provider: AgentProvider): string | null {
  const source = findModel(catalog, model);
  if (!source) return pickInTier(catalog, provider, "balanced");
  const models = currentModels(catalog, provider);
  const pool = models.some((m) => m.tier === source.tier) ? models.filter((m) => m.tier === source.tier) : models;
  return [...pool].sort((a, b) => priceDistance(a.pricing, source.pricing) - priceDistance(b.pricing, source.pricing) || byPrice(a, b))[0]?.id ?? null;
}

/**
 * A company's model for a tier (role defaults): the current model of that tier, else of the nearest tier. On OpenRouter
 * OPENROUTER_DEFAULT_MAKER's model of the tier first; otherwise the tier's cheapest, so a default never starts on the
 * priciest model of a band.
 */
export function pickInTier(catalog: ModelCatalog, provider: AgentProvider, tier: ModelTier): string | null {
  const models = currentModels(catalog, provider);
  for (const t of TIER_ORDER[tier]) {
    const inTier = models.filter((m) => m.tier === t);
    if (!inTier.length) continue;
    const preferred = provider === "openrouter" ? inTier.filter((m) => m.maker === OPENROUTER_DEFAULT_MAKER) : [];
    return [...(preferred.length ? preferred : inTier)].sort(byPrice).at(-1)!.id;
  }
  return null;
}

/** "$2 / $10": price per 1M tokens in and out, as the picker shows it. */
export function formatPrice(pricing: ModelPricing) {
  const usd = (value: number) => `$${Number(value.toPrecision(3))}`;
  return `${usd(pricing.input)} / ${usd(pricing.output)}`;
}

/** "1M context", "200K context". */
export function formatContext(tokens: number | null) {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M context`;
  return `${Math.round(tokens / 1000)}K context`;
}
