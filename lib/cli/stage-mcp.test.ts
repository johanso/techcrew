import { describe, expect, it } from "vitest";

import { toolsFor } from "@/lib/agent-tools";
import { mcpToolsFrom } from "@/lib/mcp-protocol";

// What a CLI agent sees over MCP is exactly toolsFor's set for its stage and permissions (plus its finish tool).
const names = (stage: Parameters<typeof toolsFor>[0]["stage"], permissions: Parameters<typeof toolsFor>[0]["permissions"]) =>
  mcpToolsFrom(toolsFor({ stage, permissions, branch: "agent/acm-1-x" }), 100_000).map((tool) => tool.name);

describe("MCP tool listing", () => {
  it("gives the Developer with Write code the write and merge tools", () => {
    const listed = names("development", ["repo.read", "code.write", "pr.open"]);
    expect(listed).toEqual(expect.arrayContaining(["read_file", "write_file", "replace_in_file", "merge_default_branch"]));
  });

  it("never gives a reviewer a write tool", () => {
    const listed = names("review", ["repo.read", "code.write", "ci.read"]);
    expect(listed).toEqual(expect.arrayContaining(["read_file", "get_diff", "get_checks"]));
    expect(listed).not.toContain("write_file");
  });

  it("follows permissions: no repository reads without Read repository", () => {
    expect(names("analysis", [])).toEqual([]);
  });

  it("keeps each tool's schema and raises Claude Code's inline cap", () => {
    const [tool] = mcpToolsFrom([{ name: "submit_work", description: "Finish.", parameters: { type: "object", properties: { summary: { type: "string" } } } }], 100_000);
    expect(tool).toEqual({
      name: "submit_work",
      description: "Finish.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } } },
      _meta: { "anthropic/maxResultSizeChars": 100_000 },
    });
  });
});
