import { describe, expect, it } from "vitest";

import { ANSWER_MAX, parseAnswer } from "@/lib/agent-run-config";

describe("parseAnswer", () => {
  it("trims and accepts a normal answer", () => {
    expect(parseAnswer("  It's a static site: open index.html.  ")).toEqual({ ok: true, value: "It's a static site: open index.html." });
  });

  it("rejects empty, blank and non-string input", () => {
    for (const raw of ["", "   \n", undefined, null, 42, { text: "hi" }]) {
      expect(parseAnswer(raw).ok).toBe(false);
    }
  });

  it("enforces the length limit after trimming", () => {
    expect(parseAnswer(`  ${"a".repeat(ANSWER_MAX)}  `).ok).toBe(true);
    expect(parseAnswer("a".repeat(ANSWER_MAX + 1)).ok).toBe(false);
  });
});
