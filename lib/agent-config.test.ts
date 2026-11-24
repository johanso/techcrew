import { describe, expect, it } from "vitest";

import fixture from "@/lib/__fixtures__/openrouter-models.json";
import {
  AGENT_KEYS,
  AGENT_ROLES,
  PROVIDER_IDS,
  agentModel,
  agentModelFor,
  defaultProvider,
  fallbackProvider,
  normalizeFallbackOrder,
  effectiveFallbackOrder,
  formatMicros,
  roleDefaultModel,
} from "@/lib/agent-config";
import { buildCatalog, findModel, modelProvider, parseCatalogResponse } from "@/lib/model-catalog-config";
import { SEED_CATALOG } from "@/lib/model-seed";

const NOW = new Date("2026-11-21T00:00:00Z");
// The trimmed real catalog of 2026-11-21: Claude Fable 5.2, GPT-6.2 Sol and Astra are current there.
const live = buildCatalog(parseCatalogResponse(fixture, NOW), { now: NOW, fetchedAt: NOW.toISOString(), source: "stored" });

describe("roles", () => {
  it("defines every key with a default model on every company, from the catalog", () => {
    for (const key of AGENT_KEYS) {
      const role = AGENT_ROLES[key];
      expect(role.id).toBe(key);
      for (const catalog of [SEED_CATALOG, live]) {
        for (const provider of PROVIDER_IDS) {
          const model = findModel(catalog, roleDefaultModel(catalog, key, provider));
          expect(model?.provider, `${key} ${provider}`).toBe(provider);
          expect(model?.current, `${key} ${provider}`).toBe(true);
        }
      }
    }
  });

  it("starts the Tester on a fast model and the others on a balanced one", () => {
    expect(AGENT_ROLES.tester.defaults.tier).toBe("fast");
    for (const key of AGENT_KEYS.filter((k) => k !== "tester")) expect(AGENT_ROLES[key].defaults.tier, key).toBe("balanced");
    expect(roleDefaultModel(live, "developer", "anthropic")).toBe("claude-sonnet-5-5");
    expect(roleDefaultModel(live, "tester", "anthropic")).toBe("claude-haiku-5-5");
    expect(roleDefaultModel(live, "developer", "openai")).toBe("gpt-6.1-terra");
    expect(roleDefaultModel(live, "tester", "openai")).toBe("gpt-6-luna");
    // OpenRouter defaults look at DeepSeek first.
    expect(roleDefaultModel(live, "developer", "openrouter")).toBe("deepseek/deepseek-v4-pro-0813");
    expect(roleDefaultModel(live, "tester", "openrouter")).toBe("deepseek/deepseek-v4.1-flash-1017");
  });

  it("keeps the reviewers that gate a merge read-only by default", () => {
    const writes = ["code.write", "tests.write", "deps.manage", "pr.open", "pr.merge", "issues.create", "tests.run", "secrets.read"];
    for (const key of ["security", "lead"] as const) {
      expect(AGENT_ROLES[key].defaults.permissions.filter((permission) => writes.includes(permission)), key).toEqual([]);
    }
  });
});

describe("agentModelFor", () => {
  it("restores the model remembered for that company", () => {
    expect(agentModelFor(live, "developer", "anthropic", "gpt-6.1-sol", { anthropic: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });

  it("falls back to the same tier when the remembered model left the catalog", () => {
    expect(agentModelFor(live, "tester", "anthropic", "gpt-6-luna", { anthropic: "claude-haiku-9-9" })).toBe("claude-haiku-5-5");
  });

  it("falls back to the closest equivalent the first time", () => {
    expect(agentModelFor(live, "tester", "anthropic", "gpt-6-luna", {})).toBe("claude-haiku-5-5");
  });

  it("keeps the current model when it's already on that company, even an older one", () => {
    expect(agentModelFor(live, "reviewer", "openai", "gpt-6.1-terra", {})).toBe("gpt-6.1-terra");
    expect(agentModelFor(live, "reviewer", "openai", "gpt-6.1-sol", {})).toBe("gpt-6.1-sol");
  });

  it("uses the role default for an id no company takes", () => {
    expect(agentModelFor(live, "analyst", "anthropic", "retired-model", {})).toBe("claude-sonnet-5-5");
  });

  it("moves to OpenRouter tier for tier", () => {
    expect(findModel(live, agentModelFor(live, "tester", "openrouter", "gpt-6-luna", {}))?.tier).toBe("fast");
    expect(agentModelFor(live, "lead", "openai", "claude-sonnet-5-5", {})).toBe("gpt-6.1-terra");
  });

  it("ignores a remembered model from the wrong company", () => {
    expect(agentModelFor(live, "developer", "openai", "claude-sonnet-5-5", { openai: "claude-opus-5-5" })).toBe("gpt-6.1-terra");
  });
});

describe("formatMicros", () => {
  it("shows sub-cent spend with more precision", () => {
    expect(formatMicros(0)).toBe("$0.00");
    expect(formatMicros(3_100)).toBe("$0.0031");
    expect(formatMicros(1_250_000)).toBe("$1.25");
  });
});

describe("agentModel", () => {
  it("keeps a saved model on either company, and falls back to the role's OpenAI default for a retired id", () => {
    expect(agentModel("developer", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(agentModel("tester", "gpt-6-luna")).toBe("gpt-6-luna");
    expect(modelProvider(agentModel("analyst", "retired-model"))).toBe("openai");
    // Any id shaped like a company's model is kept: the catalog decides what's offered, not what runs.
    expect(agentModel("developer", "claude-fable-5-2")).toBe("claude-fable-5-2");
  });
});

describe("defaultProvider", () => {
  it("starts new agents on a company with a key, OpenAI first", () => {
    expect(defaultProvider({ openai: true, anthropic: true, openrouter: true })).toBe("openai");
    expect(defaultProvider({ openai: false, anthropic: true, openrouter: true })).toBe("anthropic");
    expect(defaultProvider({ openai: false, anthropic: false, openrouter: true })).toBe("openrouter");
    expect(defaultProvider({ openai: false, anthropic: false, openrouter: false })).toBe("openai");
  });
});

describe("fallbackProvider", () => {
  it("picks the first other company with a key", () => {
    expect(fallbackProvider("openai", { openai: true, anthropic: true, openrouter: true })).toBe("anthropic");
    expect(fallbackProvider("openai", { openai: true, anthropic: false, openrouter: true })).toBe("openrouter");
    expect(fallbackProvider("openrouter", { openai: false, anthropic: true, openrouter: true })).toBe("anthropic");
  });

  it("is null when no other company has a key", () => {
    expect(fallbackProvider("anthropic", { openai: false, anthropic: true, openrouter: false })).toBeNull();
  });
});

describe("vision", () => {
  it("comes from the catalog's input modalities", () => {
    for (const model of live.models) expect(typeof model.vision, model.id).toBe("boolean");
    const blind = live.models.filter((m) => m.current && !m.vision).map((m) => m.id);
    // OpenAI and Claude models all take images; on OpenRouter, DeepSeek V4 Pro and GLM 5.3 are text only.
    expect(blind).toEqual(["deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.3"]);
  });
});

describe("fallbackProvider with an order", () => {
  const all = { openai: true, anthropic: true, openrouter: true };

  it("follows the order and skips the broke company", () => {
    expect(fallbackProvider("anthropic", all, ["openrouter", "openai", "anthropic"])).toBe("openrouter");
    expect(fallbackProvider("openrouter", all, ["openrouter", "openai", "anthropic"])).toBe("openai");
  });

  it("skips companies without a key", () => {
    expect(fallbackProvider("anthropic", { ...all, openrouter: false }, ["openrouter", "openai"])).toBe("openai");
  });

  it("falls back to the built-in order for companies the order doesn't list", () => {
    expect(fallbackProvider("anthropic", all, ["anthropic"])).toBe("openai");
    expect(fallbackProvider("anthropic", { openai: false, anthropic: true, openrouter: true }, ["openai"])).toBe("openrouter");
  });

  it("never returns the broke company or one without a key", () => {
    expect(fallbackProvider("anthropic", { openai: false, anthropic: true, openrouter: false }, ["anthropic", "openai"])).toBeNull();
  });

  it("behaves as before without an order", () => {
    expect(fallbackProvider("openai", all, null)).toBe("anthropic");
  });
});

describe("normalizeFallbackOrder", () => {
  it("keeps known companies once, in order", () => {
    expect(normalizeFallbackOrder(["openrouter", "openai", "openrouter", "anthropic"])).toEqual(["openrouter", "openai", "anthropic"]);
  });

  it("drops unknown ids and garbage", () => {
    expect(normalizeFallbackOrder(["gemini", 3, null, "anthropic"])).toEqual(["anthropic"]);
  });

  it("is null for empty or non-array input", () => {
    expect(normalizeFallbackOrder([])).toBeNull();
    expect(normalizeFallbackOrder(["nope"])).toBeNull();
    expect(normalizeFallbackOrder("openai")).toBeNull();
    expect(normalizeFallbackOrder(undefined)).toBeNull();
  });
});

describe("effectiveFallbackOrder", () => {
  it("completes a partial order with the built-in one", () => {
    expect(effectiveFallbackOrder(["openrouter"])).toEqual(["openrouter", "openai", "anthropic"]);
    expect(effectiveFallbackOrder(null)).toEqual(["openai", "anthropic", "openrouter"]);
  });
});
