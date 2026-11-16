import { describe, expect, it } from "vitest";

import { AGENT_MODELS, EQUIVALENT_MODEL, agentModelFor, formatMicros, modelInfo, modelsFor } from "@/lib/agent-config";

describe("models per provider", () => {
  it("lists only that company's models", () => {
    expect(modelsFor("openai").every((m) => m.provider === "openai")).toBe(true);
    expect(modelsFor("anthropic").every((m) => m.provider === "anthropic")).toBe(true);
    expect(modelsFor("openai").length + modelsFor("anthropic").length).toBe(AGENT_MODELS.length);
  });

  it("maps every model to one on the other company", () => {
    for (const model of AGENT_MODELS) expect(modelInfo(EQUIVALENT_MODEL[model.id]).provider).not.toBe(model.provider);
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
