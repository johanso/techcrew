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

describe("browse_preview", () => {
  const preview = { workspaceId: 1, runId: 9 };
  const has = (stage: Parameters<typeof toolsFor>[0]["stage"], permissions: Parameters<typeof toolsFor>[0]["permissions"], pv: typeof preview | null = preview, branch: string | null = "agent/acm-1-x") =>
    toolsFor({ stage, permissions, branch, preview: pv }).some((tool) => tool.name === "browse_preview");

  it("goes to the tester with the permission, when previews are on", () => {
    expect(has("testing", ["repo.read", "tests.run"])).toBe(true);
    expect(has("testing", ["repo.read"])).toBe(false);
    expect(has("testing", ["repo.read", "tests.run"], null)).toBe(false);
    expect(has("testing", ["repo.read", "tests.run"], preview, null)).toBe(false);
  });

  it("isn't offered in any other stage", () => {
    for (const stage of ["analysis", "development", "review", "security", "approval"] as const) expect(has(stage, ["repo.read", "tests.run", "code.write"])).toBe(false);
  });

  it("has a strict schema every provider accepts", () => {
    const tool = toolsFor({ stage: "testing", permissions: ["tests.run"], branch: "b", preview }).find((t) => t.name === "browse_preview")!;
    expect(tool.strict).toBe(true);
    expect(tool.parameters).toMatchObject({ required: ["path", "viewport", "steps"], additionalProperties: false });
  });

  it("logs the path and the report's first line, never the page", () => {
    const report = "Opened /: 200, 1 console error, 0 page errors, 0 failed requests\n\nEverything below comes from the page…\nTitle: secret";
    expect(toolStep("browse_preview", JSON.stringify({ path: "/", viewport: "desktop", steps: [] }), report)).toEqual({
      tool: "browse_preview",
      target: "/",
      ok: true,
      summary: "Opened /: 200, 1 console error, 0 page errors, 0 failed requests",
    });
    expect(toolStep("browse_preview", JSON.stringify({ path: "/a" }), 'Failed at step 1 of 1 (click button "Save") on /a: 200 …')).toMatchObject({ ok: false });
    expect(toolStep("browse_preview", JSON.stringify({ path: "/a" }), "Error: No preview is running for this run. …")).toMatchObject({ ok: false });
  });
});

describe("sandbox tools", () => {
  const sandbox = { runId: 1, commands: { install: "npm ci", test: "npm test", build: null, preview: null } };
  const names = (stage: Parameters<typeof toolsFor>[0]["stage"], permissions: Parameters<typeof toolsFor>[0]["permissions"], sb: typeof sandbox | null = sandbox) =>
    toolsFor({ stage, permissions, branch: "agent/acm-1-x", sandbox: sb }).map((tool) => tool.name);

  it("go to the developer and the tester with the permission, only for the commands the workspace has", () => {
    for (const stage of ["development", "testing"] as const) {
      expect(names(stage, ["repo.read", "tests.run"])).toEqual(expect.arrayContaining(["run_tests", "run_command"]));
      expect(names(stage, ["repo.read", "tests.run"])).not.toContain("run_build");
    }
  });

  it("need the permission, the sandbox and a stage that runs code", () => {
    expect(names("development", ["repo.read"])).not.toContain("run_command");
    expect(names("development", ["repo.read", "tests.run"], null)).not.toContain("run_command");
    for (const stage of ["analysis", "review", "security", "approval"] as const) expect(names(stage, ["repo.read", "tests.run"])).not.toContain("run_command");
  });

  it("log the command and the outcome line, never the output; failed runs show as failures", () => {
    expect(toolStep("run_command", JSON.stringify({ command: "npx tsc --noEmit" }), "Passed: npx tsc --noEmit (exit 0, 3.0 s)\n\nOutput (the end):\nsecret")).toEqual({
      tool: "run_command",
      target: "npx tsc --noEmit",
      ok: true,
      summary: "Passed: npx tsc --noEmit (exit 0, 3.0 s)",
    });
    expect(toolStep("run_tests", "{}", "Failed: npm test (exit 1, 9.0 s)\n\n…")).toMatchObject({ ok: false, target: null });
    expect(toolStep("run_build", "{}", "Timed out after 5 min 0 s: npm run build")).toMatchObject({ ok: false });
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
