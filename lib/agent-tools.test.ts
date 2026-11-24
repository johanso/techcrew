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
  const preview = { workspaceId: 1, runId: 9, vision: true };
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
    expect(tool.parameters).toMatchObject({ required: ["path", "viewport", "color_scheme", "steps"], additionalProperties: false });
    expect(JSON.stringify(tool.parameters)).toContain('"enum":["desktop","tablet","mobile"]');
    expect(JSON.stringify(tool.parameters)).toContain('"enum":["light","dark"]');
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
  const sandbox = { runId: 1, allowScripts: false, commands: { install: "npm ci", test: "npm test", build: null, preview: null } };
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

  it("add_dependency goes only to the developer, with code.write and deps.manage, while the sandbox is on", () => {
    expect(names("development", ["repo.read", "code.write", "deps.manage"])).toContain("add_dependency");
    // It runs no code, so tests.run isn't needed.
    expect(names("development", ["code.write", "deps.manage"])).toContain("add_dependency");
    expect(names("development", ["repo.read", "code.write", "tests.run"])).not.toContain("add_dependency");
    expect(names("development", ["repo.read", "deps.manage", "tests.run"])).not.toContain("add_dependency");
    expect(names("development", ["repo.read", "code.write", "deps.manage"], null)).not.toContain("add_dependency");
    expect(toolsFor({ stage: "development", permissions: ["code.write", "deps.manage"], branch: null, sandbox }).map((t) => t.name)).not.toContain("add_dependency");
    for (const stage of ["analysis", "review", "security", "approval", "testing"] as const) {
      expect(names(stage, ["repo.read", "code.write", "deps.manage", "tests.run"]), stage).not.toContain("add_dependency");
    }
  });

  it("add_dependency has a strict schema and logs the package and the first line only", () => {
    const tool = toolsFor({ stage: "development", permissions: ["code.write", "deps.manage"], branch: "b", sandbox }).find((t) => t.name === "add_dependency")!;
    expect(tool.parameters).toMatchObject({ required: ["name", "version", "dev"], additionalProperties: false });
    const step = toolStep("add_dependency", JSON.stringify({ name: "@fontsource/inter", version: null, dev: false }), 'Added @fontsource/inter@5.3.0 to dependencies ("^5.3.0"): committed …\nImport it …');
    expect(step).toEqual({ tool: "add_dependency", target: null, ok: true, summary: 'Added @fontsource/inter@5.3.0 to dependencies ("^5.3.0"): committed …' });
    expect(toolStep("add_dependency", "{}", "Failed while installing dependencies: npm install … (exit 1, 3.0 s)\n\nOutput (the end):\nnpm error 404")).toMatchObject({ ok: false });
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

describe("reference tools", () => {
  const references = { items: [{ id: 7 } as never], vision: true };

  it("are offered in every stage only when the card has references", () => {
    for (const stage of ["analysis", "development", "review", "security", "approval", "testing"] as const) {
      expect(toolsFor({ stage, permissions: ["repo.read"], branch: null, references }).map((t) => t.name), stage).toEqual(
        expect.arrayContaining(["list_references", "read_reference"])
      );
      expect(toolsFor({ stage, permissions: [], branch: null, references: { items: [], vision: true } }).map((t) => t.name)).not.toContain("read_reference");
      expect(toolsFor({ stage, permissions: [], branch: null, references: null }).map((t) => t.name)).not.toContain("list_references");
    }
  });

  it("never log what a reference says", () => {
    const step = toolStep("read_reference", JSON.stringify({ id: 7, offset: null }), "spec.md (characters 0–40 of 40; …)\n<reference>secret plan</reference>");
    expect(step).toEqual({ tool: "read_reference", target: null, ok: true, summary: null });
    expect(toolStep("read_reference", JSON.stringify({ id: 99, offset: null }), "Error: no reference with id 99 on this card.").ok).toBe(false);
  });
});

describe("merge tools", () => {
  const MERGE = ["merge_default_branch", "read_conflict", "resolve_conflict", "finish_merge"];
  const names = (stage: Parameters<typeof toolsFor>[0]["stage"], permissions: Parameters<typeof toolsFor>[0]["permissions"], branch: string | null = "agent/acm-1-x") =>
    toolsFor({ stage, permissions, branch }).map((tool) => tool.name);

  it("go to the developer with Write code once the branch exists", () => {
    expect(names("development", ["repo.read", "code.write"])).toEqual(expect.arrayContaining(MERGE));
    expect(names("development", ["repo.read"])).not.toContain("merge_default_branch");
    expect(names("development", ["repo.read", "code.write"], null)).not.toContain("merge_default_branch");
    for (const stage of ["analysis", "review", "security", "approval", "testing"] as const) {
      expect(names(stage, ["repo.read", "code.write", "deps.manage", "tests.run"]), stage).not.toContain("merge_default_branch");
    }
  });

  it("have strict schemas", () => {
    const tools = toolsFor({ stage: "development", permissions: ["code.write"], branch: "b" }).filter((t) => MERGE.includes(t.name));
    expect(tools).toHaveLength(4);
    for (const tool of tools) expect(tool.strict).toBe(true);
    expect(tools.find((t) => t.name === "resolve_conflict")!.parameters).toMatchObject({ required: ["path", "content"], additionalProperties: false });
    expect(JSON.stringify(tools.find((t) => t.name === "finish_merge")!.parameters)).toContain('"enum":["commit","abort"]');
  });

  it("log the file, never its content", () => {
    expect(toolStep("read_conflict", JSON.stringify({ path: "src/app.ts", start_line: null, end_line: null }), "src/app.ts: 1 conflicting section …\n1: secret")).toEqual({
      tool: "read_conflict",
      target: "src/app.ts",
      ok: true,
      summary: null,
    });
    expect(toolStep("resolve_conflict", JSON.stringify({ path: "src/app.ts", content: "secret code" }), "Resolved src/app.ts: 1 conflict left.")).toEqual({
      tool: "resolve_conflict",
      target: "src/app.ts",
      ok: true,
      summary: "Resolved src/app.ts: 1 conflict left.",
    });
    expect(toolStep("finish_merge", JSON.stringify({ outcome: "commit" }), "Error: 1 conflict still unresolved: src/a.ts.")).toMatchObject({ ok: false, target: null });
  });
});
