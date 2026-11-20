import { describe, expect, it, vi } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseInput } from "openai/resources/responses/responses";

import {
  chatImagesMessage,
  claudeToolResultContent,
  hydrateChatMessages,
  hydrateClaudeMessages,
  hydrateOpenAIInput,
  memoLoader,
  missingImageNote,
  openAIToolOutput,
  placeholderId,
  referencePlaceholder,
  type ImageLoader,
} from "@/lib/reference-images";

const PNG = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };
// Reference 7 exists; anything else was removed from the card.
const load: ImageLoader = async (id) => (id === 7 ? PNG : null);

describe("placeholders", () => {
  it("round-trips a reference id and ignores anything else", () => {
    expect(placeholderId(referencePlaceholder(42))).toBe(42);
    expect(placeholderId("data:image/png;base64,AAAA")).toBeNull();
    expect(placeholderId("https://example.com/a.png")).toBeNull();
    expect(placeholderId("techteam-reference:abc")).toBeNull();
    expect(placeholderId("techteam-reference:-1")).toBeNull();
    expect(placeholderId(null)).toBeNull();
  });

  it("never puts image bytes in what gets stored", () => {
    const stored = JSON.stringify([openAIToolOutput("x", { referenceId: 7 }), claudeToolResultContent("x", { referenceId: 7 }), chatImagesMessage([{ referenceId: 7, name: "a.png" }])]);
    expect(stored).not.toContain(PNG.base64);
    expect(stored).toContain("techteam-reference:7");
  });
});

describe("OpenAI (Responses)", () => {
  it("keeps plain text outputs as strings", () => {
    expect(openAIToolOutput("Read 3 files", null)).toBe("Read 3 files");
  });

  it("swaps the placeholder for a data URL, or a note when the reference is gone", async () => {
    const input: ResponseInput = [
      { role: "user", content: "brief" },
      { type: "function_call_output", call_id: "a", output: openAIToolOutput("home.png attached", { referenceId: 7 }) },
      { type: "function_call_output", call_id: "b", output: openAIToolOutput("old.png attached", { referenceId: 9 }) },
      { type: "function_call_output", call_id: "c", output: "plain" },
    ];
    const hydrated = await hydrateOpenAIInput(input, load);
    expect(hydrated[0]).toEqual(input[0]);
    expect(hydrated[1]).toEqual({
      type: "function_call_output",
      call_id: "a",
      output: [
        { type: "input_text", text: "home.png attached" },
        { type: "input_image", image_url: `data:image/png;base64,${PNG.base64}`, detail: "auto" },
      ],
    });
    expect(hydrated[2]).toMatchObject({ output: [{ type: "input_text" }, { type: "input_text", text: missingImageNote(9) }] });
    expect(hydrated[3]).toEqual(input[3]);
    // The state passed in keeps its placeholders.
    expect(JSON.stringify(input)).not.toContain(PNG.base64);
  });
});

describe("Anthropic (Messages)", () => {
  it("puts the image in the tool_result and hydrates it to base64", async () => {
    const messages: BetaMessageParam[] = [
      { role: "user", content: "brief" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_reference", input: { id: 7, offset: null } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: claudeToolResultContent("home.png attached", { referenceId: 7 }) },
          { type: "tool_result", tool_use_id: "t2", content: claudeToolResultContent("gone.png attached", { referenceId: 3 }) },
          { type: "tool_result", tool_use_id: "t3", content: "text only" },
        ],
      },
    ];
    const hydrated = await hydrateClaudeMessages(messages, load);
    expect(hydrated.slice(0, 2)).toEqual(messages.slice(0, 2));
    const [first, second, third] = (hydrated[2]!.content as { content: unknown }[]).map((block) => block.content);
    expect(first).toEqual([
      { type: "text", text: "home.png attached" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.base64 } },
    ]);
    expect(second).toEqual([
      { type: "text", text: "gone.png attached" },
      { type: "text", text: missingImageNote(3) },
    ]);
    expect(third).toBe("text only");
  });
});

describe("OpenRouter (Chat Completions)", () => {
  it("sends images in a user message after the tool messages", () => {
    expect(chatImagesMessage([])).toBeNull();
    const message = chatImagesMessage([{ referenceId: 7, name: "home.png" }]);
    expect(message).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image_url", image_url: { url: "techteam-reference:7" } }],
    });
  });

  it("hydrates placeholders to data URLs and leaves other messages alone", async () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "brief" },
      { role: "tool", tool_call_id: "c1", content: "home.png attached" },
      chatImagesMessage([
        { referenceId: 7, name: "home.png" },
        { referenceId: 5, name: "gone.png" },
      ])!,
    ];
    const hydrated = await hydrateChatMessages(messages, load);
    expect(hydrated.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(hydrated[2]).toMatchObject({
      content: [
        { type: "text" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.base64}` } },
        { type: "text", text: missingImageNote(5) },
      ],
    });
  });
});

describe("memoLoader", () => {
  it("loads each image once per request and turns failures into a missing image", async () => {
    const inner = vi.fn(async (id: number) => {
      if (id === 2) throw new Error("S3 down");
      return PNG;
    });
    const memo = memoLoader(inner);
    await Promise.all([memo(1), memo(1), memo(1)]);
    expect(inner).toHaveBeenCalledTimes(1);
    await expect(memo(2)).resolves.toBeNull();
  });
});
