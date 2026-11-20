import { describe, expect, it } from "vitest";

import {
  AGENT_KEYS,
  AGENT_MODELS,
  AGENT_ROLES,
  PROVIDER_IDS,
  agentModel,
  agentModelFor,
  closestModel,
  defaultProvider,
  fallbackProvider,
  formatMicros,
  makersOf,
  modelInfo,
  modelsFor,
} from "@/lib/agent-config";

describe("models per provider", () => {
  it("lists only that company's models", () => {
    expect(modelsFor("openai").every((m) => m.provider === "openai")).toBe(true);
    expect(modelsFor("anthropic").every((m) => m.provider === "anthropic")).toBe(true);
    expect(modelsFor("openrouter").every((m) => m.provider === "openrouter")).toBe(true);
    expect(PROVIDER_IDS.reduce((sum, provider) => sum + modelsFor(provider).length, 0)).toBe(AGENT_MODELS.length);
  });

  it("finds a closest model for every model on every other company", () => {
    for (const model of AGENT_MODELS) {
      for (const provider of PROVIDER_IDS) expect(modelInfo(closestModel(model.id, provider)!).provider).toBe(provider);
    }
  });

  it("keeps the tier when there is one, else takes the more capable neighbor", () => {
    expect(closestModel("gpt-6.1-sol", "openrouter")).toBe("deepseek/deepseek-v4-pro-0813");
    expect(closestModel("claude-haiku-5-5", "openrouter")).toBe("deepseek/deepseek-v4.1-flash");
    expect(closestModel("google/gemini-4-argon", "anthropic")).toBe("claude-opus-5-5");
    expect(closestModel("x-ai/grok-build-0.1", "anthropic")).toBe("claude-sonnet-5-5");
    expect(closestModel("gpt-6.1-terra", "anthropic")).toBe("claude-sonnet-5-5");
  });

  it("groups OpenRouter models by maker", () => {
    expect(makersOf("openrouter")).toEqual(["Google", "xAI", "DeepSeek", "Z.ai", "Moonshot"]);
    expect(makersOf("openai")).toEqual(["OpenAI"]);
  });
});

describe("roles", () => {
  it("defines every key with defaults on both companies", () => {
    for (const key of AGENT_KEYS) {
      const role = AGENT_ROLES[key];
      expect(role.id).toBe(key);
      expect(modelInfo(role.defaults.models.openai).provider).toBe("openai");
      expect(modelInfo(role.defaults.models.anthropic).provider).toBe("anthropic");
      expect(modelInfo(role.defaults.models.openrouter).provider).toBe("openrouter");
    }
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
    expect(agentModelFor("developer", "anthropic", "gpt-6.1-sol", { anthropic: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });

  it("falls back to the closest equivalent the first time", () => {
    expect(agentModelFor("tester", "anthropic", "gpt-6-luna", {})).toBe("claude-haiku-5-5");
  });

  it("keeps the current model when it's already on that company", () => {
    expect(agentModelFor("reviewer", "openai", "gpt-6.1-terra", {})).toBe("gpt-6.1-terra");
  });

  it("uses the role default for an unknown model", () => {
    expect(agentModelFor("analyst", "anthropic", "retired-model", {})).toBe("claude-sonnet-5-5");
  });

  it("moves to OpenRouter tier for tier", () => {
    expect(agentModelFor("tester", "openrouter", "gpt-6-luna", {})).toBe("deepseek/deepseek-v4.1-flash");
    expect(agentModelFor("lead", "openai", "z-ai/glm-5.3", {})).toBe("gpt-6.1-sol");
  });

  it("ignores a remembered model from the wrong company", () => {
    expect(agentModelFor("developer", "openai", "claude-sonnet-5-5", { openai: "claude-opus-5-5" })).toBe("gpt-6.1-sol");
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
    expect(agentModel("analyst", "retired-model")).toBe(AGENT_ROLES.analyst.defaults.models.openai);
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
  it("is set on every model", () => {
    for (const model of AGENT_MODELS) expect(typeof model.vision, model.id).toBe("boolean");
  });

  it("matches the providers' model pages", () => {
    const blind = AGENT_MODELS.filter((m) => !m.vision).map((m) => m.id);
    // OpenAI and Claude models all take images; on OpenRouter, DeepSeek V4 Pro and GLM 5.3 are text only.
    expect(blind).toEqual(["deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.3"]);
  });
});
