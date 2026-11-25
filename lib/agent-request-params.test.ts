import { describe, expect, it } from "vitest";

import fixture from "@/lib/__fixtures__/openrouter-models.json";
import { AGENT_STAGES } from "@/lib/agent-run-config";
import {
  DEFAULT_EFFORTS,
  MODEL_EFFORTS,
  STAGE_EFFORT,
  claudeEffort,
  librarianClaudeEffort,
  librarianEffort,
  modelKnobs,
  openAIRequestParams,
  openRouterRequestParams,
  stageEffort,
} from "@/lib/agent-request-params";
import { buildCatalog, findModel, parseCatalogResponse } from "@/lib/model-catalog-config";
import { SEED_CATALOG } from "@/lib/model-seed";

const NOW = new Date("2026-11-21T00:00:00Z");
const live = buildCatalog(parseCatalogResponse(fixture, NOW), { now: NOW, fetchedAt: NOW.toISOString(), source: "stored" });
const knobs = (id: string) => modelKnobs(id, findModel(SEED_CATALOG, id) ?? findModel(live, id));

describe("modelKnobs", () => {
  it("takes the hand-checked levels for known ids", () => {
    expect(knobs("gpt-6.1-terra").efforts).toEqual(MODEL_EFFORTS["gpt-6.1-terra"]);
    expect(knobs("x-ai/grok-build-0.1").efforts).toBeNull();
  });

  it("takes the catalog's levels for a model nobody checked by hand", () => {
    expect(MODEL_EFFORTS["claude-fable-5-2"]).toBeUndefined();
    expect(knobs("claude-fable-5-2")).toEqual({ efforts: ["low", "medium", "high", "xhigh", "max"], verbosity: true });
    expect(knobs("gpt-6.2-sol").verbosity).toBe(true);
    expect(knobs("deepseek/deepseek-v4.1-flash-1017")).toEqual({ efforts: ["none", "low", "high", "max"], verbosity: false });
  });

  it("is conservative when the catalog lists reasoning_effort without levels, and sends nothing otherwise", () => {
    expect(modelKnobs("x/new-model", { parameters: ["tools", "reasoning_effort"], efforts: null }).efforts).toEqual(DEFAULT_EFFORTS);
    expect(modelKnobs("x/new-model", { parameters: ["tools"], efforts: null })).toEqual({ efforts: null, verbosity: false });
    expect(modelKnobs("x/unknown", undefined)).toEqual({ efforts: null, verbosity: false });
  });
});

describe("stageEffort", () => {
  it("asks for low effort on the Lead's stage only, on models that take it", () => {
    expect(stageEffort(knobs("gpt-6.1-sol"), "approval")).toBe("low");
    expect(stageEffort(knobs("deepseek/deepseek-v4-pro-0813"), "approval")).toBe("low");
    for (const stage of AGENT_STAGES.filter((s) => s !== "approval")) expect(stageEffort(knobs("gpt-6.1-sol"), stage), stage).toBeNull();
  });

  it("never sends an effort to a model whose values are unknown", () => {
    expect(stageEffort(knobs("x-ai/grok-build-0.1"), "approval")).toBeNull();
    expect(stageEffort(modelKnobs("x/unknown", undefined), "approval")).toBeNull();
  });

  it("only requests efforts each model lists", () => {
    for (const model of [...SEED_CATALOG.models, ...live.models]) {
      const k = modelKnobs(model.id, model);
      for (const stage of AGENT_STAGES) {
        const effort = stageEffort(k, stage);
        if (effort) expect(k.efforts, `${model.id} ${stage}`).toContain(effort);
      }
    }
    for (const effort of Object.values(STAGE_EFFORT)) if (effort) expect(["none", "low", "medium", "high", "xhigh", "max"]).toContain(effort);
  });
});

describe("per-provider parameters", () => {
  it("OpenAI: low verbosity outside development, effort only where the stage sets one", () => {
    expect(openAIRequestParams(knobs("gpt-6.1-sol"), "development")).toEqual({});
    expect(openAIRequestParams(knobs("gpt-6.1-sol"), "review")).toEqual({ text: { verbosity: "low" } });
    expect(openAIRequestParams(knobs("gpt-6.1-sol"), "approval")).toEqual({ reasoning: { effort: "low" }, text: { verbosity: "low" } });
    // A model the catalog doesn't say takes verbosity gets none.
    expect(openAIRequestParams(modelKnobs("gpt-x", undefined), "review")).toEqual({});
  });

  it("Anthropic: medium as before, low for the Lead, none for a model without effort", () => {
    expect(claudeEffort(knobs("claude-sonnet-5-5"), "development")).toBe("medium");
    expect(claudeEffort(knobs("claude-haiku-5-5"), "testing")).toBe("medium");
    expect(claudeEffort(knobs("claude-opus-5-5"), "approval")).toBe("low");
    expect(claudeEffort(knobs("claude-fable-5-2"), "approval")).toBe("low");
    expect(claudeEffort(modelKnobs("claude-haiku-4-5", { parameters: ["tools", "structured_outputs", "reasoning"], efforts: null }), "development")).toBeNull();
  });

  it("OpenRouter: reasoning effort only, never verbosity or parallel_tool_calls (require_parameters would leave no host)", () => {
    expect(openRouterRequestParams(knobs("deepseek/deepseek-v4-pro-0813"), "development")).toEqual({});
    expect(openRouterRequestParams(knobs("z-ai/glm-5.3"), "approval")).toEqual({ reasoning: { effort: "low" } });
    for (const model of [...SEED_CATALOG.models, ...live.models].filter((m) => m.provider === "openrouter")) {
      for (const stage of AGENT_STAGES) {
        const params = openRouterRequestParams(modelKnobs(model.id, model), stage);
        expect(Object.keys(params).every((key) => key === "reasoning"), `${model.id} ${stage}`).toBe(true);
      }
    }
  });
});

describe("the librarian's call", () => {
  it("learns at low effort where the model lists it, and builds a first memory at the usual one", () => {
    expect(librarianEffort(knobs("gpt-6-luna"), "learn")).toBe("low");
    expect(librarianEffort(knobs("gpt-6.1-sol"), "bootstrap")).toBeNull();
    expect(librarianEffort(modelKnobs("x/unknown", undefined), "learn")).toBeNull();
    expect(librarianClaudeEffort(knobs("claude-haiku-5-5"), "learn")).toBe("low");
    expect(librarianClaudeEffort(knobs("claude-sonnet-5-5"), "bootstrap")).toBe("medium");
    expect(librarianClaudeEffort(modelKnobs("claude-haiku-4-5", { parameters: ["tools"], efforts: null }), "learn")).toBeNull();
  });
});
