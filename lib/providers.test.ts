import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { isAnthropicOutOfCredit, messageCostMicros, toClaudeSchema } from "@/lib/anthropic";
import { isOpenAIOutOfCredit, responseCostMicros } from "@/lib/openai";

const headers = new Headers();

describe("out-of-credit detection", () => {
  it("recognizes OpenAI's quota and billing codes, not plain rate limits", () => {
    const quota = new OpenAI.RateLimitError(429, { code: "insufficient_quota", message: "You exceeded your current quota" }, undefined, headers);
    const rate = new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded", message: "Slow down" }, undefined, headers);
    expect(isOpenAIOutOfCredit(quota)).toBe(true);
    expect(isOpenAIOutOfCredit(rate)).toBe(false);
    expect(isOpenAIOutOfCredit(new Error("insufficient_quota"))).toBe(false);
  });

  it("recognizes Anthropic's low credit balance", () => {
    const credit = new Anthropic.BadRequestError(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
      "Your credit balance is too low to access the Anthropic API.",
      headers
    );
    const other = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, "max_tokens too large", headers);
    expect(isAnthropicOutOfCredit(credit)).toBe(true);
    expect(isAnthropicOutOfCredit(other)).toBe(false);
  });
});

describe("cost accounting", () => {
  it("prices OpenAI usage per 1M tokens, with cached input cheaper", () => {
    // GPT-6.1 Sol: $2 in, $0.10 cached, $10 out per 1M tokens.
    const usage = { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 100_000, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1_100_000 };
    expect(responseCostMicros("gpt-6.1-sol", usage)).toBe(3_000_000);
    const cached = { ...usage, input_tokens_details: { cached_tokens: 1_000_000, cache_write_tokens: 0 } };
    expect(responseCostMicros("gpt-6.1-sol", cached)).toBe(1_100_000);
    expect(responseCostMicros("gpt-6.1-sol", null)).toBe(0);
  });

  it("prices Claude usage with cache reads and writes", () => {
    // Claude Sonnet 5.5: $2 in, $0.20 cache read, $2.50 cache write, $10 out per 1M tokens.
    const usage = { input_tokens: 100_000, output_tokens: 10_000, cache_read_input_tokens: 500_000, cache_creation_input_tokens: 200_000 };
    expect(messageCostMicros("claude-sonnet-5-5", "claude-sonnet-5-5", usage)).toBe(200_000 + 100_000 + 500_000 + 100_000);
  });

  it("prices Haiku's long prompts at the higher rate", () => {
    const long = { input_tokens: 150_000, output_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null };
    const short = { ...long, input_tokens: 50_000 };
    expect(messageCostMicros("claude-haiku-5-5", "claude-haiku-5-5", long)).toBe(75_000);
    expect(messageCostMicros("claude-haiku-5-5", "claude-haiku-5-5", short)).toBe(5_000);
  });
});

describe("toClaudeSchema", () => {
  it("turns nullable type arrays into anyOf, recursively", () => {
    const schema = { type: "object", properties: { note: { type: ["string", "null"], description: "Optional" } } };
    expect(toClaudeSchema(schema)).toEqual({
      type: "object",
      properties: { note: { description: "Optional", anyOf: [{ type: "string" }, { type: "null" }] } },
    });
  });
});
