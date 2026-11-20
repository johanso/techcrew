import { describe, expect, it } from "vitest";

import { AGENT_MODELS } from "@/lib/agent-config";
import { AGENT_STAGES } from "@/lib/agent-run-config";
import { MODEL_EFFORTS, STAGE_EFFORT, claudeEffort, openAIRequestParams, openRouterRequestParams, stageEffort } from "@/lib/agent-request-params";

describe("stageEffort", () => {
  it("asks for low effort on the Lead's stage only, on models that take it", () => {
    expect(stageEffort("gpt-6.1-sol", "approval")).toBe("low");
    expect(stageEffort("deepseek/deepseek-v4-pro-0813", "approval")).toBe("low");
    for (const stage of AGENT_STAGES.filter((s) => s !== "approval")) expect(stageEffort("gpt-6.1-sol", stage), stage).toBeNull();
  });

  it("never sends an effort to a model whose values are unknown", () => {
    expect(stageEffort("x-ai/grok-build-0.1", "approval")).toBeNull();
  });

  it("only requests efforts each model lists", () => {
    for (const model of AGENT_MODELS) {
      for (const stage of AGENT_STAGES) {
        const effort = stageEffort(model.id, stage);
        if (effort) expect(MODEL_EFFORTS[model.id], `${model.id} ${stage}`).toContain(effort);
      }
    }
    for (const effort of Object.values(STAGE_EFFORT)) if (effort) expect(["none", "low", "medium", "high", "xhigh", "max"]).toContain(effort);
  });
});

describe("per-provider parameters", () => {
  it("OpenAI: low verbosity outside development, effort only where the stage sets one", () => {
    expect(openAIRequestParams("gpt-6.1-sol", "development")).toEqual({});
    expect(openAIRequestParams("gpt-6.1-sol", "review")).toEqual({ text: { verbosity: "low" } });
    expect(openAIRequestParams("gpt-6.1-sol", "approval")).toEqual({ reasoning: { effort: "low" }, text: { verbosity: "low" } });
  });

  it("Anthropic: medium as before, low for the Lead", () => {
    expect(claudeEffort("claude-sonnet-5-5", "development")).toBe("medium");
    expect(claudeEffort("claude-haiku-5-5", "testing")).toBe("medium");
    expect(claudeEffort("claude-opus-5-5", "approval")).toBe("low");
  });

  it("OpenRouter: reasoning effort only, never verbosity or parallel_tool_calls (require_parameters would leave no host)", () => {
    expect(openRouterRequestParams("deepseek/deepseek-v4-pro-0813", "development")).toEqual({});
    expect(openRouterRequestParams("z-ai/glm-5.3", "approval")).toEqual({ reasoning: { effort: "low" } });
    for (const model of AGENT_MODELS.filter((m) => m.provider === "openrouter")) {
      for (const stage of AGENT_STAGES) {
        const params = openRouterRequestParams(model.id, stage);
        expect(Object.keys(params).every((key) => key === "reasoning"), `${model.id} ${stage}`).toBe(true);
      }
    }
  });
});
