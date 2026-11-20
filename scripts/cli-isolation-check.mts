/**
 * Isolation check for agents on the owner's plan (docs/cli-agents-plan.md §3.3). Run it only with the owner's OK: it
 * sends one short prompt through the Claude plan signed in under TechTeam's config home.
 *
 *   npx tsx scripts/cli-isolation-check.mts
 *
 * It runs Claude Code exactly as a stage does (same flags, TechTeam's config home, an allowlisted environment) against a
 * throwaway MCP server with two harmless tools, then reports:
 * - the tools, MCP servers, skills, slash commands and plugins the session started with (only mcp__techteam__* allowed),
 * - whether any hook ran (--include-hook-events), and what the model says it was told besides the system prompt,
 * - the owner's normal Claude Code login before and after (it must not change).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { MCP_TOKEN_ENV, claudeChunkArgs, foreignTools, parseClaudeStream } from "../lib/cli/claude-config";
import { handleMcpBody, mcpToolsFrom, type McpRegistry } from "../lib/mcp-protocol";

const binary = process.env.CLAUDE_CLI_PATH || path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const configDir = path.join(process.env.TECHTEAM_CLI_HOME || path.join(os.homedir(), ".techteam", "cli"), "claude");
const baseEnv = Object.fromEntries(
  ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!]] : []
  )
);

function run(args: string[], env: Record<string, string>, input = "", cwd = os.tmpdir()): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => process.stderr.write(d));
    child.on("close", () => resolve(out));
    child.stdin.end(input);
  });
}

const status = async (env: Record<string, string>) => {
  const raw = await run(["auth", "status", "--json"], env);
  try {
    const parsed = JSON.parse(raw) as { loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string };
    return `${parsed.loggedIn ? "signed in" : "signed out"} ${parsed.email ?? ""} ${parsed.orgName ?? ""} ${parsed.subscriptionType ?? ""}`.trim();
  } catch {
    return raw.trim();
  }
};

const token = randomUUID();
const calls: string[] = [];
const registry: McpRegistry = {
  server: { name: "techteam", version: "1" },
  listTools: async () =>
    mcpToolsFrom(
      [
        { name: "ping", description: "Answers pong.", parameters: { type: "object", properties: {} } },
        { name: "submit_report", description: "Finish with your report.", parameters: { type: "object", properties: { report: { type: "string" } }, required: ["report"] } },
      ],
      100_000
    ),
  callTool: async (name, args) => {
    calls.push(name);
    return { content: [{ type: "text", text: name === "ping" ? "pong" : `recorded: ${JSON.stringify(args).slice(0, 2000)}` }] };
  },
};
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.headers.authorization !== `Bearer ${token}` || req.method !== "POST") {
    res.writeHead(req.method === "POST" ? 401 : 405).end();
    return;
  }
  const out = await handleMcpBody(registry, body);
  if (out === null) res.writeHead(202).end();
  else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const work = await mkdtemp(path.join(os.tmpdir(), "techteam-isolation-"));
const systemPromptFile = path.join(work, "system.md");
await writeFile(systemPromptFile, "You are an isolation probe for TechTeam. Answer truthfully and briefly.");

const normalBefore = await status(baseEnv);
const techteam = await status({ ...baseEnv, CLAUDE_CONFIG_DIR: configDir });
console.log(`Your normal Claude Code login: ${normalBefore}`);
console.log(`TechTeam's Claude Code login:  ${techteam}`);

const args = [
  ...claudeChunkArgs({
    model: "claude-haiku-5-5",
    maxTurns: 3,
    sessionId: randomUUID(),
    resume: false,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    systemPromptFile,
    effort: "low",
  }),
  "--include-hook-events",
];
const output = await run(
  args,
  { ...baseEnv, CLAUDE_CONFIG_DIR: configDir, [MCP_TOKEN_ENV]: token, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  "List every tool you can call by its exact name. Then say whether you were given any instructions besides your system prompt (a CLAUDE.md, memory, skills, hooks) and quote their first line if so. Call ping once, then submit_report with your answer.",
  work
);
server.close();

const summary = parseClaudeStream(output);
const hookEvents = output.split("\n").filter((line) => line.includes('"hook')).length;
const init = summary.init;
console.log("\nSession start");
console.log(`  tools:        ${JSON.stringify(init?.tools ?? [])}`);
console.log(`  foreign:      ${JSON.stringify(init ? foreignTools(init) : [])}  (must be [])`);
console.log(`  mcp servers:  ${JSON.stringify(init?.mcpServers ?? [])}`);
const raw = output.split("\n").find((line) => line.includes('"subtype":"init"'));
if (raw) {
  const event = JSON.parse(raw) as { skills?: unknown; slash_commands?: unknown; plugins?: unknown };
  console.log(`  skills:       ${JSON.stringify(event.skills)}  slash commands: ${JSON.stringify(event.slash_commands)}`);
  console.log(`  plugins:      ${JSON.stringify(event.plugins)}`);
}
console.log(`  hook events:  ${hookEvents}  (must be 0)`);
console.log(`  tool calls:   ${calls.join(", ") || "none"}`);
console.log(`\nThe model said:\n${summary.result?.text ?? summary.lastText}`);
console.log(`\nUsage: ${summary.result?.numTurns ?? 0} turns, ≈ $${(summary.result?.costUsd ?? 0).toFixed(4)} at API prices (on your plan).`);
const normalAfter = await status(baseEnv);
console.log(`\nYour normal login afterwards: ${normalAfter} ${normalAfter === normalBefore ? "(unchanged)" : "(CHANGED: report this)"}`);
