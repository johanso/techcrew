import { describe, expect, it } from "vitest";

import {
  MCP_TOKEN_ENV,
  classifyClaudeChunk,
  claudeChunkArgs,
  foreignTools,
  mcpConfigJson,
  parseClaudeStream,
  totalTokens,
} from "@/lib/cli/claude-config";

const lines = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n");
const ok = { exitCode: 0, stderr: "", timedOut: false };

const init = (status = "connected", tools = ["mcp__techteam__read_file", "mcp__techteam__submit_work"]) => ({
  type: "system",
  subtype: "init",
  session_id: "s-1",
  tools,
  mcp_servers: [{ name: "techteam", status }],
  model: "claude-sonnet-5-5",
});

const result = (over: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 6,
  total_cost_usd: 0.4123,
  session_id: "s-1",
  result: "Done.",
  api_error_status: null,
  usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 150000, cache_creation_input_tokens: 20000 },
  ...over,
});

describe("claudeChunkArgs", () => {
  const base = { model: "claude-sonnet-5-5", maxTurns: 8, sessionId: "0b7d…", mcpUrl: "http://localhost:3000/api/mcp/runs/7?stage=development", systemPromptFile: "/tmp/run-7/system.md", effort: "high" };

  it("starts a session, then resumes it", () => {
    expect(claudeChunkArgs({ ...base, resume: false })).toEqual(expect.arrayContaining(["--session-id", "0b7d…"]));
    const resumed = claudeChunkArgs({ ...base, resume: true });
    expect(resumed).toEqual(expect.arrayContaining(["--resume", "0b7d…"]));
    expect(resumed).not.toContain("--session-id");
  });

  it("takes away every built-in tool, setting source and slash command", () => {
    const args = claudeChunkArgs({ ...base, resume: false });
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("--tools")).toBe("");
    expect(after("--setting-sources")).toBe("");
    expect(after("--allowedTools")).toBe("mcp__techteam__*");
    expect(after("--permission-prompts")).toBe("none");
    expect(after("--max-turns")).toBe("8");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args).not.toContain("--bare");
  });

  it("never puts the bearer on the command line", () => {
    const config = JSON.parse(mcpConfigJson("http://localhost:3000/api/mcp/runs/7"));
    expect(config.mcpServers.techteam.headers.Authorization).toBe(`Bearer \${${MCP_TOKEN_ENV}}`);
    expect(claudeChunkArgs({ ...base, resume: false }).join(" ")).not.toMatch(/Bearer [A-Za-z0-9_-]{20}/);
  });

  it("leaves out effort when the model has none", () => {
    expect(claudeChunkArgs({ ...base, effort: null, resume: false })).not.toContain("--effort");
  });
});

describe("parseClaudeStream", () => {
  it("reads the session, the tools, the turns, the cost and the tokens", () => {
    const summary = parseClaudeStream(
      lines(init(), { type: "assistant", message: { content: [{ type: "text", text: "Reading files." }] } }, result()) + "\nnot json\n"
    );
    expect(summary.sessionId).toBe("s-1");
    expect(summary.init?.mcpServers).toEqual([{ name: "techteam", status: "connected" }]);
    expect(summary.assistantMessages).toBe(1);
    expect(summary.result).toMatchObject({ subtype: "success", numTurns: 6, costUsd: 0.4123 });
    expect(totalTokens(summary.result!.usage)).toBe(174600);
  });

  it("keeps the plan's rejection and its reset time", () => {
    const summary = parseClaudeStream(lines(init(), { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1795689600, rateLimitType: "five_hour" } }));
    expect(summary.rateLimit).toEqual({ resetsAt: new Date(1795689600 * 1000).toISOString(), type: "five_hour" });
  });

  it("ignores warnings that aren't rejections", () => {
    expect(parseClaudeStream(lines({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 1795689600 } })).rateLimit).toBeNull();
  });
});

describe("classifyClaudeChunk", () => {
  it("is fine when the agent stopped or used its turns", () => {
    expect(classifyClaudeChunk(parseClaudeStream(lines(init(), result())), ok)).toEqual({ kind: "ok" });
    expect(classifyClaudeChunk(parseClaudeStream(lines(init(), result({ subtype: "error_max_turns", is_error: true }))), ok)).toEqual({ kind: "ok" });
  });

  it("recognizes the plan's limit, with or without a reset time", () => {
    const rejected = lines(init(), { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1795689600 } }, result({ is_error: true }));
    expect(classifyClaudeChunk(parseClaudeStream(rejected), ok)).toMatchObject({ kind: "plan_limit", resetsAt: expect.any(String) });
    const worded = lines(init(), result({ is_error: true, result: "Claude usage limit reached. Your limit will reset at 3pm." }));
    expect(classifyClaudeChunk(parseClaudeStream(worded), ok)).toEqual({ kind: "plan_limit", resetsAt: null });
  });

  it("recognizes a model the plan doesn't include", () => {
    const text = "Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login.";
    expect(classifyClaudeChunk(parseClaudeStream(lines(init(), result({ is_error: true, result: text }))), ok)).toMatchObject({ kind: "model_unavailable" });
  });

  it("recognizes a missing login (what 2.1.326 prints)", () => {
    const stream = lines(init("failed", []), result({ is_error: true, num_turns: 1, result: "Not logged in · Please run /login", total_cost_usd: 0 }));
    expect(classifyClaudeChunk(parseClaudeStream(stream), ok)).toMatchObject({ kind: "auth" });
  });

  it("fails when TechTeam's tools didn't connect", () => {
    expect(classifyClaudeChunk(parseClaudeStream(lines(init("failed", []), result())), ok)).toMatchObject({ kind: "error", message: expect.stringContaining("MCP failed") });
  });

  it("never reads the agent's own prose on a chunk that ended normally", () => {
    const prose = { type: "assistant", message: { content: [{ type: "text", text: "Added a banner for when the usage limit is reached and users are not logged in." }] } };
    expect(classifyClaudeChunk(parseClaudeStream(lines(init(), prose, result({ result: "Usage limit reached banner done; login expired page next." }))), ok)).toEqual({ kind: "ok" });
    expect(classifyClaudeChunk(parseClaudeStream(lines(init(), prose, result({ subtype: "error_max_turns", is_error: true }))), ok)).toEqual({ kind: "ok" });
  });

  it("stops on tools TechTeam didn't give the session", () => {
    expect(classifyClaudeChunk(parseClaudeStream(lines(init())), { ...ok, foreign: ["Bash"] })).toEqual({ kind: "isolation", tools: ["Bash"] });
  });

  it("reports a crash from stderr", () => {
    expect(classifyClaudeChunk(parseClaudeStream(""), { exitCode: 1, stderr: "error: unknown option '--frobnicate'\n", timedOut: false })).toEqual({
      kind: "error",
      message: "error: unknown option '--frobnicate'",
    });
  });

  it("reports a timeout", () => {
    expect(classifyClaudeChunk(parseClaudeStream(lines(init())), { exitCode: null, stderr: "", timedOut: true })).toMatchObject({ kind: "error" });
  });
});

describe("foreignTools", () => {
  it("lists anything that isn't TechTeam's", () => {
    expect(foreignTools(parseClaudeStream(lines(init())).init!)).toEqual([]);
    expect(foreignTools(parseClaudeStream(lines(init("connected", ["Bash", "mcp__techteam__read_file", "mcp__work__query"]))).init!)).toEqual(["Bash", "mcp__work__query"]);
  });
});
