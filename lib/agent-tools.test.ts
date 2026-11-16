import { describe, expect, it } from "vitest";

import { toolStep, toolsFor } from "@/lib/agent-tools";

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

describe("toolsFor", () => {
  const names = (stage: Parameters<typeof toolsFor>[0]["stage"], permissions: Parameters<typeof toolsFor>[0]["permissions"]) =>
    toolsFor({ stage, permissions, branch: "agent/acm-1-x" }).map((tool) => tool.name);

  it("gives the security reviewer and the lead the diff and CI, never writes", () => {
    for (const stage of ["security", "approval"] as const) {
      expect(names(stage, ["repo.read", "ci.read", "code.write"])).toEqual(["list_files", "read_file", "search_code", "get_diff", "get_checks"]);
    }
  });

  it("writes only in development, with the permission", () => {
    expect(names("development", ["repo.read", "code.write"])).toContain("write_file");
    expect(names("development", ["repo.read"])).not.toContain("write_file");
  });

  it("has no diff before the branch exists", () => {
    expect(toolsFor({ stage: "review", permissions: ["repo.read"], branch: null }).map((tool) => tool.name)).not.toContain("get_diff");
  });
});

describe("skill tools", () => {
  it("are offered in every stage only when the agent has skills", () => {
    for (const stage of ["analysis", "development", "review", "security", "approval", "testing"] as const) {
      expect(toolsFor({ stage, permissions: ["repo.read"], branch: null, skills: [{}] }).map((t) => t.name), stage).toEqual(
        expect.arrayContaining(["search_skill", "read_skill"])
      );
      expect(toolsFor({ stage, permissions: ["repo.read"], branch: null, skills: [] }).map((t) => t.name)).not.toContain("search_skill");
    }
  });

  it("log the skill and file or query, never the content", () => {
    expect(toolStep("read_skill", JSON.stringify({ skill: "web", path: "guides/a.md", offset: null }), "web/guides/a.md (characters …)\nsecret text")).toEqual({
      tool: "read_skill",
      target: "web/guides/a.md",
      ok: true,
      summary: null,
    });
    expect(toolStep("search_skill", JSON.stringify({ skill: "web", query: "dialog" }), "2 matches …").target).toBe("web: dialog");
  });
});
