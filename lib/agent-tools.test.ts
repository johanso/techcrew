import { describe, expect, it } from "vitest";

import { toolStep } from "@/lib/agent-tools";

describe("toolStep (agent log)", () => {
  it("keeps the target and drops the content of reads", () => {
    expect(toolStep("read_file", JSON.stringify({ path: "src/app.ts" }), "1: import x\n2: …")).toEqual({
      tool: "read_file",
      target: "src/app.ts",
      ok: true,
      summary: null,
    });
  });

  it("keeps a write's confirmation", () => {
    const step = toolStep("write_file", JSON.stringify({ path: "README.md", content: "…" }), "Updated README.md on agent/acm-1.\n");
    expect(step).toMatchObject({ ok: true, target: "README.md", summary: "Updated README.md on agent/acm-1." });
  });

  it("marks errors as failures, with the message", () => {
    expect(toolStep("replace_in_file", JSON.stringify({ path: "a.ts" }), "Error: old_text appears 2 times.")).toMatchObject({ ok: false, summary: "Error: old_text appears 2 times." });
    expect(toolStep("list_files", "{}", "GitHub error (404): Not Found")).toMatchObject({ ok: false, target: null });
  });

  it("survives arguments that aren't JSON", () => {
    expect(toolStep("search_code", "{oops", "Error: arguments were not valid JSON.")).toMatchObject({ target: null, ok: false });
  });

  it("clips long summaries", () => {
    expect(toolStep("get_checks", "{}", "x".repeat(500)).summary).toHaveLength(200);
  });
});
