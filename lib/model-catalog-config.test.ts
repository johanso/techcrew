import { describe, expect, it } from "vitest";

import fixture from "@/lib/__fixtures__/openrouter-models.json";
import {
  CATALOG_MAX_AGE_MS,
  buildCatalog,
  catalogEntries,
  catalogLabel,
  catalogStale,
  closestModel,
  currentModels,
  findModel,
  formatContext,
  formatPrice,
  isCatalogModel,
  isModelId,
  makersOf,
  modelFamily,
  modelLabel,
  modelProvider,
  openRouterIdOf,
  parseCatalogResponse,
  parsePricing,
  perMillion,
  pickInTier,
  pickerCatalog,
  pickerModels,
  routeOf,
  tierAt,
  type CatalogEntry,
} from "@/lib/model-catalog-config";
import { SEED_CATALOG, SEED_ENTRIES } from "@/lib/model-seed";

// The fixture is a trimmed copy of OpenRouter's real /models response of 2026-11-21 (only the fields and models used here).
const NOW = new Date("2026-11-21T00:00:00Z");
const entries = parseCatalogResponse(fixture, NOW);
const live = buildCatalog(entries, { now: NOW, fetchedAt: NOW.toISOString(), source: "stored" });
const ids = (provider: "openai" | "anthropic" | "openrouter") => currentModels(live, provider).map((m) => m.id);

describe("route ids", () => {
  it("maps catalog ids to the ids each API takes", () => {
    expect(routeOf("anthropic/claude-opus-5.5")).toEqual({ id: "claude-opus-5-5", provider: "anthropic", maker: "Anthropic" });
    expect(routeOf("anthropic/claude-fable-5.2")?.id).toBe("claude-fable-5-2");
    expect(routeOf("anthropic/claude-opus-5")?.id).toBe("claude-opus-5");
    expect(routeOf("openai/gpt-6.1-sol")).toEqual({ id: "gpt-6.1-sol", provider: "openai", maker: "OpenAI" });
    expect(routeOf("deepseek/deepseek-v4-pro-0813")).toEqual({ id: "deepseek/deepseek-v4-pro-0813", provider: "openrouter", maker: "DeepSeek" });
    expect(routeOf("x-ai/grok-4.7")?.maker).toBe("xAI");
  });

  it("leaves out companies and models TechTeam doesn't offer", () => {
    expect(routeOf("qwen/qwen4-max")).toBeNull();
    expect(routeOf("openai/o3")).toBeNull();
    expect(routeOf("anthropic/other")).toBeNull();
    expect(routeOf("no-slash")).toBeNull();
  });

  it("matches the ids agents already store", () => {
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-6.1-terra", "gpt-6-luna", "deepseek/deepseek-v4-pro-0813"]) {
      expect(findModel(live, id)?.id, id).toBe(id);
    }
  });

  it("maps back both ways for every model in the catalog", () => {
    for (const entry of entries) {
      const route = routeOf(entry.openRouterId)!;
      expect(openRouterIdOf(route.id), route.id).toBe(entry.openRouterId);
    }
    // A date isn't a version.
    expect(openRouterIdOf("claude-opus-4-20250514")).toBe("anthropic/claude-opus-4-20250514");
    expect(openRouterIdOf("retired-model")).toBeNull();
  });

  it("knows a model's company from its id alone", () => {
    expect(modelProvider("claude-sonnet-5-5")).toBe("anthropic");
    expect(modelProvider("gpt-6.2-sol")).toBe("openai");
    expect(modelProvider("z-ai/glm-5.3")).toBe("openrouter");
    expect(modelProvider("retired-model")).toBeNull();
    expect(modelProvider("a/b/c")).toBeNull();
    expect(isModelId("gpt-6.1-terra")).toBe(true);
    expect(isModelId("")).toBe(false);
    expect(isModelId(42)).toBe(false);
  });
});

describe("parsing", () => {
  it("converts per-token prices to USD per million without float noise", () => {
    expect(perMillion("0.0000001")).toBe(0.1);
    expect(perMillion("0.000002")).toBe(2);
    expect(perMillion("0.00000132")).toBe(1.32);
    expect(perMillion("-1")).toBeNull();
    expect(perMillion("free")).toBeNull();
    expect(perMillion(undefined)).toBeNull();
  });

  it("reads cache prices and the long-prompt rate", () => {
    const haiku = findModel(live, "claude-haiku-5-5")!.pricing;
    expect(haiku).toEqual({ input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5 } });
    // No cache prices listed: they cost what input costs.
    expect(parsePricing({ prompt: "0.000001", completion: "0.000004" })).toEqual({ input: 1, cachedInput: 1, cacheWrite: 1, output: 4 });
    expect(parsePricing({ prompt: "0.000001" })).toBeNull();
  });

  it("drops the company prefix from names", () => {
    expect(modelLabel("Anthropic: Claude Fable 5.2")).toBe("Claude Fable 5.2");
    expect(modelLabel("SpaceXSI: Grok 4.7")).toBe("Grok 4.7");
    expect(modelLabel("Plain")).toBe("Plain");
  });

  it("keeps effort levels in our order and drops ones we don't know", () => {
    const [entry] = parseCatalogResponse(
      {
        data: [
          {
            id: "google/gemini-9",
            name: "Google: Gemini 9",
            created: 1_790_000_000,
            pricing: { prompt: "0.000001", completion: "0.000002" },
            architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            supported_parameters: ["tools", "structured_outputs", "reasoning_effort"],
            reasoning: { supported_efforts: ["high", "minimal", "low", "none"] },
          },
        ],
      },
      NOW
    );
    expect(entry.efforts).toEqual(["none", "low", "high"]);
    expect(entry.vision).toBe(false);
  });

  it("leaves out variants, previews, other outputs, models without tools and structured outputs, and other companies", () => {
    const parsed = entries.map((e) => e.openRouterId);
    for (const id of [
      "anthropic/claude-fable-5.2:batch",
      "google/gemini-3.1-pro-preview",
      "deepseek/deepseek-v4-flash-vision-exp",
      "google/gemini-nano-banana-2.1",
      "google/gemini-omni-1.2-flash",
      "z-ai/glm-5.3-prime",
      "openai/o3",
      "qwen/qwen4-max",
    ]) {
      expect(parsed, id).not.toContain(id);
    }
  });

  it("leaves out OpenRouter's mode twins, not a real model of the same name", () => {
    const parsed = entries.map((e) => e.openRouterId);
    expect(parsed).not.toContain("openai/gpt-6.2-sol-pro");
    expect(parsed).not.toContain("openai/gpt-6.2-astra-pro");
    // GPT-5.5 Pro costs more than GPT-5.5: a model of its own.
    expect(parsed).toContain("openai/gpt-5.5-pro");
  });

  it("leaves out expired models", () => {
    expect(entries.map((e) => e.openRouterId)).toContain("openai/gpt-5");
    const later = parseCatalogResponse(fixture, new Date("2026-12-12T00:00:00Z")).map((e) => e.openRouterId);
    expect(later).not.toContain("openai/gpt-5");
  });

  it("skips what it can't read instead of failing", () => {
    expect(parseCatalogResponse(null, NOW)).toEqual([]);
    expect(parseCatalogResponse({ data: [{ id: 3 }, "x", { id: "google/x", name: "X", created: 1, pricing: {} }] }, NOW)).toEqual([]);
  });
});

describe("current models", () => {
  it("finds each model's family", () => {
    expect(modelFamily("anthropic/claude-opus-5.5")).toBe("anthropic/claude-opus");
    expect(modelFamily("openai/gpt-6.2-sol")).toBe("openai/gpt-sol");
    expect(modelFamily("openai/gpt-6-sol")).toBe("openai/gpt-sol");
    expect(modelFamily("deepseek/deepseek-v4-pro-0813")).toBe("deepseek/deepseek-pro");
    expect(modelFamily("deepseek/deepseek-v4.1-flash-1017")).toBe("deepseek/deepseek-flash");
    expect(modelFamily("moonshotai/kimi-k3.1-pro")).toBe("moonshotai/kimi-pro");
    expect(modelFamily("z-ai/glm-5.3-flash")).toBe("z-ai/glm-flash");
  });

  it("offers the newest model of each family: Claude Fable 5.2 and GPT-6.2 without any code change", () => {
    expect(ids("anthropic")).toEqual(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(ids("openai")).toEqual(["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna"]);
    expect(ids("openrouter")).toEqual([
      "google/gemini-4-argon",
      "google/gemini-4-hydrogen",
      "google/gemini-3.8-flash",
      "x-ai/grok-4.7",
      "deepseek/deepseek-v4-pro-0813",
      "deepseek/deepseek-v4.1-flash-1017",
      "z-ai/glm-5.3",
      "z-ai/glm-5.3-flash",
      "moonshotai/kimi-k3.1-pro",
    ]);
  });

  it("drops families that stopped long before their company's newest model", () => {
    // GPT-5.5 (April) is its family's newest, but OpenAI shipped GPT-6.2 seven months later.
    expect(findModel(live, "gpt-5.5")?.current).toBe(false);
    expect(findModel(live, "gpt-5.5-pro")?.current).toBe(false);
  });

  it("keeps older models known, with a price and a tier, for agents that still use them", () => {
    const older = findModel(live, "gpt-6.1-sol")!;
    expect(older.current).toBe(false);
    expect(older.pricing.output).toBe(10);
    expect(older.tier).toBe(findModel(live, "gpt-6.2-sol")!.tier);
    expect(isCatalogModel(live, "gpt-6.1-sol")).toBe(true);
    expect(isCatalogModel(live, "gpt-1")).toBe(false);
  });

  it("stops offering a model that left the catalog or expired", () => {
    const gone = entries.map((e) => (e.openRouterId === "anthropic/claude-fable-5.2" ? { ...e, listed: false } : e));
    const catalog = buildCatalog(gone, { now: NOW, fetchedAt: null, source: "stored" });
    expect(findModel(catalog, "claude-fable-5-2")?.current).toBe(false);
    // Its family's previous version takes over.
    expect(findModel(catalog, "claude-fable-5-1")?.current).toBe(true);
    const expired = entries.map((e) => (e.openRouterId === "anthropic/claude-fable-5.2" ? { ...e, expiresAt: "2026-11-20T00:00:00Z" } : e));
    expect(findModel(buildCatalog(expired, { now: NOW, fetchedAt: null, source: "stored" }), "claude-fable-5-2")?.current).toBe(false);
  });
});

describe("tiers", () => {
  it("ranks by output price: top third flagship, bottom third fast", () => {
    expect([0, 1, 2].map((i) => tierAt(i, 3))).toEqual(["flagship", "balanced", "fast"]);
    expect([0, 1, 2, 3].map((i) => tierAt(i, 4))).toEqual(["flagship", "flagship", "balanced", "fast"]);
    expect([0, 1].map((i) => tierAt(i, 2))).toEqual(["flagship", "balanced"]);
    expect(tierAt(0, 1)).toBe("balanced");
  });

  it("places each company's current models", () => {
    const tiers = (provider: "openai" | "anthropic") => Object.fromEntries(currentModels(live, provider).map((m) => [m.id, m.tier]));
    expect(tiers("anthropic")).toEqual({ "claude-fable-5-2": "flagship", "claude-opus-5-5": "flagship", "claude-sonnet-5-5": "balanced", "claude-haiku-5-5": "fast" });
    expect(tiers("openai")).toEqual({ "gpt-6.2-astra": "flagship", "gpt-6.2-sol": "flagship", "gpt-6.1-terra": "balanced", "gpt-6-luna": "fast" });
  });
});

describe("closestModel", () => {
  it("finds a current model on every company for every model", () => {
    for (const model of live.models) {
      for (const provider of ["openai", "anthropic", "openrouter"] as const) {
        const closest = findModel(live, closestModel(live, model.id, provider)!);
        expect(closest?.provider, `${model.id} → ${provider}`).toBe(provider);
        expect(closest?.current).toBe(true);
      }
    }
  });

  it("keeps the tier, nearest in price within it", () => {
    expect(closestModel(live, "gpt-6.1-terra", "anthropic")).toBe("claude-sonnet-5-5");
    expect(closestModel(live, "claude-sonnet-5-5", "openai")).toBe("gpt-6.1-terra");
    expect(closestModel(live, "claude-haiku-5-5", "openai")).toBe("gpt-6-luna");
    expect(closestModel(live, "gpt-6.2-astra", "anthropic")).toBe("claude-fable-5-2");
    expect(closestModel(live, "claude-opus-5-5", "openai")).toBe("gpt-6.2-sol");
  });

  it("treats an unknown model as balanced", () => {
    expect(closestModel(live, "claude-unknown-1", "openai")).toBe("gpt-6.1-terra");
  });

  it("falls to the nearest tier when a company lacks one", () => {
    const twoModels = buildCatalog(
      entries.filter((e) => ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-6-luna"].includes(e.openRouterId)),
      { now: NOW, fetchedAt: null, source: "stored" }
    );
    // Anthropic has a flagship and a balanced model here; Luna, alone on OpenAI, is balanced too: nearest in price.
    expect(closestModel(twoModels, "gpt-6-luna", "anthropic")).toBe("claude-sonnet-5-5");
    expect(findModel(twoModels, "claude-sonnet-5-5")?.tier).toBe("balanced");
    expect(pickInTier(twoModels, "openrouter", "fast")).toBeNull();
  });
});

describe("pickers", () => {
  it("lists a company's current models, plus the agent's older one", () => {
    expect(pickerModels(live, "openai").map((m) => m.id)).toEqual(ids("openai"));
    expect(pickerModels(live, "openai", "gpt-6.1-sol").map((m) => m.id)).toEqual([...ids("openai"), "gpt-6.1-sol"]);
    // Another company's model isn't added.
    expect(pickerModels(live, "openai", "claude-opus-5-5").map((m) => m.id)).toEqual(ids("openai"));
    // One the catalog never knew still shows, without a price.
    const unknown = pickerModels(live, "anthropic", "claude-retired-1").at(-1)!;
    expect(unknown).toMatchObject({ id: "claude-retired-1", label: "claude-retired-1", current: false, vision: false });
  });

  it("groups OpenRouter models by maker, in picker order", () => {
    expect(makersOf(pickerModels(live, "openrouter"))).toEqual(["Google", "xAI", "DeepSeek", "Z.ai", "Moonshot"]);
    expect(makersOf(pickerModels(live, "openai"))).toEqual(["OpenAI"]);
  });

  it("sends the browser current models and the team's own only", () => {
    const sent = pickerCatalog(live, ["gpt-6.1-sol", "claude-sonnet-5-5", "z-ai/glm-0"]);
    expect(sent.models.filter((m) => !m.current).map((m) => m.id)).toEqual(["gpt-6.1-sol", "z-ai/glm-0"]);
    expect(sent.models.filter((m) => m.current)).toHaveLength(live.models.filter((m) => m.current).length);
  });

  it("names a model by its label, else its id", () => {
    expect(catalogLabel(live, "claude-fable-5-2")).toBe("Claude Fable 5.2");
    expect(catalogLabel(live, "gpt-1")).toBe("gpt-1");
  });

  it("formats prices and context", () => {
    expect(formatPrice({ input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 })).toBe("$2 / $10");
    expect(formatPrice({ input: 0.0699, cachedInput: 0, cacheWrite: 0, output: 1.4 })).toBe("$0.0699 / $1.4");
    expect(formatContext(1_050_000)).toBe("1.1M context");
    expect(formatContext(1_000_000)).toBe("1M context");
    expect(formatContext(200_000)).toBe("200K context");
    expect(formatContext(null)).toBeNull();
  });
});

describe("fallback order", () => {
  const stored: CatalogEntry[] = entries;

  it("runs on the seed until something is stored", () => {
    const { entries: used, source } = catalogEntries([], SEED_ENTRIES);
    expect(source).toBe("seed");
    expect(used).toBe(SEED_ENTRIES);
    // Existing agents keep working on the seed: their models are there, with prices.
    for (const id of ["claude-sonnet-5-5", "gpt-6.1-terra", "deepseek/deepseek-v4-pro-0813"]) expect(findModel(SEED_CATALOG, id)?.current, id).toBe(true);
  });

  it("prefers the stored catalog, with seed models it lacks kept as older", () => {
    const { entries: used, source } = catalogEntries(stored, SEED_ENTRIES);
    expect(source).toBe("stored");
    const catalog = buildCatalog(used, { now: NOW, fetchedAt: NOW.toISOString(), source });
    // Grok Build 0.1 left OpenRouter's list: still priced and named, no longer offered.
    expect(findModel(catalog, "x-ai/grok-build-0.1")).toMatchObject({ label: "Grok Build 0.1", current: false });
    // A stored model wins over the seed's copy (the catalog's newer price).
    expect(findModel(catalog, "claude-sonnet-5-5")?.pricing.cachedInput).toBe(0.1);
    expect(currentModels(catalog, "anthropic").map((m) => m.id)).toEqual(ids("anthropic"));
  });

  it("refreshes a catalog older than a day", () => {
    expect(catalogStale(null, NOW)).toBe(true);
    expect(catalogStale(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe(false);
    expect(catalogStale(new Date(NOW.getTime() - CATALOG_MAX_AGE_MS - 1).toISOString(), NOW)).toBe(true);
  });
});
