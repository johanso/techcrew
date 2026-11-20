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
  imagePlaceholder,
  missingImageNote,
  openAIToolOutput,
  parsePlaceholder,
  referenceImage,
  screenshotIdOf,
  screenshotImage,
  type ImageLoader,
  type ToolImage,
} from "@/lib/reference-images";

const PNG = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };
const JPEG = { mediaType: "image/jpeg" as const, base64: "/9j/4AAQ" };
const SHOT = "0b7d9f3e-2c41-4a8e-9b1f-5d6e7f8a9b0c";
// Reference 7 (an image), link 8 (desktop and mobile) and screenshot SHOT exist; anything else is gone.
const load: ImageLoader = async (image) => {
  if (image.kind === "screenshot") return image.id === SHOT ? PNG : null;
  if (image.id === 7 && image.view === "image") return PNG;
  if (image.id === 8 && image.view !== "image") return JPEG;
  return null;
};
const ref = (id: number) => [referenceImage(id)];

describe("placeholders", () => {
  it("round-trips reference images, link screenshots and run screenshots", () => {
    const images: ToolImage[] = [referenceImage(42), referenceImage(8, "desktop"), referenceImage(8, "mobile"), screenshotImage(SHOT)];
    for (const image of images) expect(parsePlaceholder(imagePlaceholder(image))).toEqual(image);
    // Placeholders stored before links existed still read as the image itself.
    expect(parsePlaceholder("techteam-reference:42")).toEqual(referenceImage(42));
    expect(imagePlaceholder(referenceImage(8, "mobile"))).toBe("techteam-reference:8:mobile");
  });

  it("ignores anything else", () => {
    for (const value of [
      "data:image/png;base64,AAAA",
      "https://example.com/a.png",
      "techteam-reference:abc",
      "techteam-reference:-1",
      "techteam-reference:0",
      "techteam-reference:7:tablet",
      "techteam-screenshot:../../other-run/x",
      "techteam-screenshot:not-a-uuid",
      null,
    ]) {
      expect(parsePlaceholder(value), String(value)).toBeNull();
    }
  });

  it("reads a screenshot's id from its key, only for a uuid PNG", () => {
    expect(screenshotIdOf(`run-screenshots/3/51/${SHOT}.png`)).toBe(SHOT);
    expect(screenshotIdOf("run-screenshots/3/51/evil.png")).toBeNull();
    expect(screenshotIdOf(`card-references/3/9/${SHOT}.jpg`)).toBeNull();
  });

  it("never puts image bytes in what gets stored", () => {
    const stored = JSON.stringify([
      openAIToolOutput("x", ref(7)),
      claudeToolResultContent("x", [referenceImage(8, "desktop"), referenceImage(8, "mobile")]),
      chatImagesMessage([{ image: screenshotImage(SHOT), name: "screenshot of /" }]),
    ]);
    expect(stored).not.toContain(PNG.base64);
    expect(stored).not.toContain(JPEG.base64);
    expect(stored).toContain("techteam-reference:7");
    expect(stored).toContain("techteam-reference:8:desktop");
    expect(stored).toContain(`techteam-screenshot:${SHOT}`);
  });
});

describe("OpenAI (Responses)", () => {
  it("keeps plain text outputs as strings", () => {
    expect(openAIToolOutput("Read 3 files", [])).toBe("Read 3 files");
  });

  it("swaps the placeholder for a data URL, or a note when the reference is gone", async () => {
    const input: ResponseInput = [
      { role: "user", content: "brief" },
      { type: "function_call_output", call_id: "a", output: openAIToolOutput("home.png attached", ref(7)) },
      { type: "function_call_output", call_id: "b", output: openAIToolOutput("old.png attached", ref(9)) },
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
    expect(hydrated[2]).toMatchObject({ output: [{ type: "input_text" }, { type: "input_text", text: missingImageNote(referenceImage(9)) }] });
    expect(hydrated[3]).toEqual(input[3]);
    // The state passed in keeps its placeholders.
    expect(JSON.stringify(input)).not.toContain(PNG.base64);
  });

  it("attaches both screenshots of a link and a run screenshot in order", async () => {
    const input: ResponseInput = [
      { type: "function_call_output", call_id: "a", output: openAIToolOutput("link", [referenceImage(8, "desktop"), referenceImage(8, "mobile")]) },
      { type: "function_call_output", call_id: "b", output: openAIToolOutput("Opened /", [screenshotImage(SHOT)]) },
    ];
    const hydrated = await hydrateOpenAIInput(input, load);
    expect(hydrated[0]).toMatchObject({
      output: [
        { type: "input_text", text: "link" },
        { type: "input_image", image_url: `data:image/jpeg;base64,${JPEG.base64}` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${JPEG.base64}` },
      ],
    });
    expect(hydrated[1]).toMatchObject({ output: [{ type: "input_text" }, { type: "input_image", image_url: `data:image/png;base64,${PNG.base64}` }] });
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
          { type: "tool_result", tool_use_id: "t1", content: claudeToolResultContent("home.png attached", ref(7)) },
          { type: "tool_result", tool_use_id: "t2", content: claudeToolResultContent("gone.png attached", ref(3)) },
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
      { type: "text", text: missingImageNote(referenceImage(3)) },
    ]);
    expect(third).toBe("text only");
  });
});

describe("OpenRouter (Chat Completions)", () => {
  it("sends images in a user message after the tool messages", () => {
    expect(chatImagesMessage([])).toBeNull();
    const message = chatImagesMessage([{ image: referenceImage(7), name: "home.png" }]);
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
        { image: referenceImage(7), name: "home.png" },
        { image: screenshotImage("11111111-2222-4333-8444-555555555555"), name: "screenshot of /old" },
      ])!,
    ];
    const hydrated = await hydrateChatMessages(messages, load);
    expect(hydrated.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(hydrated[2]).toMatchObject({
      content: [
        { type: "text" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.base64}` } },
        { type: "text", text: missingImageNote(screenshotImage("11111111-2222-4333-8444-555555555555")) },
      ],
    });
  });
});

describe("memoLoader", () => {
  it("loads each image once per request and turns failures into a missing image", async () => {
    const inner = vi.fn(async (image: ToolImage) => {
      if (image.kind === "reference" && image.id === 2) throw new Error("S3 down");
      return PNG;
    });
    const memo = memoLoader(inner);
    await Promise.all([memo(referenceImage(1)), memo(referenceImage(1)), memo(referenceImage(1))]);
    expect(inner).toHaveBeenCalledTimes(1);
    // A link's two screenshots are two images.
    await Promise.all([memo(referenceImage(1, "desktop")), memo(referenceImage(1, "mobile"))]);
    expect(inner).toHaveBeenCalledTimes(3);
    await expect(memo(referenceImage(2))).resolves.toBeNull();
  });
});
