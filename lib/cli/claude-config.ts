/**
 * Claude Code as an agent runtime, pure parts (lib/cli/claude-run.ts spawns it): the command line, the stream-json
 * output it prints, and what a chunk's outcome means for the stage. Flags checked against `claude --help` 2.1.326 and
 * the CLI reference (--max-turns and --system-prompt-file exist but aren't in --help).
 *
 * Isolation, in layers: TechTeam's own config home (CLAUDE_CONFIG_DIR, set by the runner), no built-in tools, only
 * TechTeam's MCP server (strict), no settings files, no slash commands or skills, nobody to answer a permission prompt.
 */

/** The MCP server's name in the CLI: its tools are `mcp__techteam__<tool>`. */
export const MCP_SERVER_NAME = "techteam";
/** The child's env variable that carries the MCP bearer: the config names it, so the secret never goes on argv. */
export const MCP_TOKEN_ENV = "TECHTEAM_MCP_TOKEN";

export type ClaudeChunkArgs = {
  model: string;
  /** This chunk's turn cap (`--max-turns`). */
  maxTurns: number;
  sessionId: string;
  /** False on a stage's first chunk (`--session-id`), true afterwards (`--resume`). */
  resume: boolean;
  /** The MCP endpoint of this run and stage (localhost). */
  mcpUrl: string;
  systemPromptFile: string;
  effort: string | null;
};

/** The MCP config passed inline: the URL is not a secret, the bearer comes from the child's environment. */
export function mcpConfigJson(url: string) {
  return JSON.stringify({
    mcpServers: { [MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } } },
  });
}

/** Arguments for one chunk of a stage (`claude -p`, prompt on stdin). Never a shell string: spawn takes the array. */
export function claudeChunkArgs(input: ClaudeChunkArgs): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--max-turns",
    String(input.maxTurns),
    ...(input.resume ? ["--resume", input.sessionId] : ["--session-id", input.sessionId]),
    "--system-prompt-file",
    input.systemPromptFile,
    // No built-in tools (Bash, Read, Edit …): the agent works only through TechTeam's tools, which enforce permissions.
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigJson(input.mcpUrl),
    "--allowedTools",
    `mcp__${MCP_SERVER_NAME}__*`,
    // No settings files at all: the owner's hooks, permissions and env from settings never apply.
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    ...(input.effort ? ["--effort", input.effort] : []),
  ];
}

// ── Output ─────────────────────────────────────────────────────────────────────

export type ClaudeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ClaudeStreamSummary = {
  sessionId: string | null;
  /** The session's start: the tools it sees and whether TechTeam's MCP server connected. */
  init: { tools: string[]; mcpServers: { name: string; status: string }[]; model: string | null } | null;
  result: {
    subtype: string;
    isError: boolean;
    numTurns: number;
    costUsd: number;
    usage: ClaudeUsage;
    text: string;
    apiErrorStatus: number | null;
    errors: string[];
  } | null;
  /** The last rejection of the plan's rate limit, when there was one. */
  rateLimit: { resetsAt: string | null; type: string | null } | null;
  /** Assistant messages seen: the turns used when the stream ends without a result (killed, crashed). */
  assistantMessages: number;
  /** The last assistant text, for an error the result doesn't carry. */
  lastText: string;
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const rec = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

function parseUsage(value: unknown): ClaudeUsage {
  const u = rec(value);
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
}

/** A reset time from seconds since the epoch (the CLI's `resetsAt`), milliseconds, or an ISO string. */
function resetTime(value: unknown): string | null {
  if (typeof value === "number" && value > 0) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/** Reads the CLI's stream-json output (one JSON object per line). Lines that aren't JSON are skipped. */
export function parseClaudeStream(output: string): ClaudeStreamSummary {
  const reader = claudeStreamReader();
  for (const line of output.split("\n")) reader.line(line);
  return reader.summary;
}

/**
 * The same, line by line as the CLI prints them, keeping only the summary: tool results (whole files) stream through
 * stdout and are never held in memory.
 */
export function claudeStreamReader() {
  const summary: ClaudeStreamSummary = { sessionId: null, init: null, result: null, rateLimit: null, assistantMessages: 0, lastText: "" };
  return { summary, line: (line: string) => readEvent(summary, line) };
}

function readEvent(summary: ClaudeStreamSummary, line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  let event: Record<string, unknown>;
  try {
    event = rec(JSON.parse(trimmed));
  } catch {
    return;
  }
  if (typeof event.session_id === "string") summary.sessionId = event.session_id;
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        summary.init = {
          tools: Array.isArray(event.tools) ? event.tools.filter((t): t is string => typeof t === "string") : [],
          mcpServers: Array.isArray(event.mcp_servers)
            ? event.mcp_servers.map((s) => ({ name: String(rec(s).name ?? ""), status: String(rec(s).status ?? "") }))
            : [],
          model: typeof event.model === "string" ? event.model : null,
        };
      }
      break;
    case "assistant": {
      summary.assistantMessages++;
      const content = rec(event.message).content;
      const text = Array.isArray(content)
        ? content.map((block) => (rec(block).type === "text" ? String(rec(block).text ?? "") : "")).join("").trim()
        : "";
      if (text) summary.lastText = text;
      break;
    }
    case "rate_limit_event": {
      const info = rec(event.rate_limit_info);
      if (info.status === "rejected") {
        summary.rateLimit = {
          resetsAt: resetTime(info.resetsAt ?? info.resets_at),
          type: typeof info.rateLimitType === "string" ? info.rateLimitType : typeof info.rate_limit_type === "string" ? info.rate_limit_type : null,
        };
      }
      break;
    }
    case "result":
      summary.result = {
        subtype: String(event.subtype ?? ""),
        isError: event.is_error === true,
        numTurns: num(event.num_turns),
        costUsd: num(event.total_cost_usd),
        usage: parseUsage(event.usage),
        text: typeof event.result === "string" ? event.result : "",
        apiErrorStatus: typeof event.api_error_status === "number" ? event.api_error_status : null,
        errors: Array.isArray(event.errors) ? event.errors.filter((e): e is string => typeof e === "string") : [],
      };
      break;
  }
}

export const totalTokens = (usage: ClaudeUsage) => usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

export type ClaudeChunkOutcome =
  /** The chunk ended normally: the agent stopped, or used its turns (the stage reads whether it finished). */
  | { kind: "ok" }
  /** The plan's usage window ran out. */
  | { kind: "plan_limit"; resetsAt: string | null }
  /** The plan doesn't include this model. */
  | { kind: "model_unavailable"; message: string }
  /** Not signed in, or the login expired. */
  | { kind: "auth"; message: string }
  /** The session had tools TechTeam didn't give it: the runner ended it at the start (isolation broken). */
  | { kind: "isolation"; tools: string[] }
  | { kind: "error"; message: string };

const PLAN_LIMIT = /(usage limit|limit reached|hit your limit|out of (extra )?usage|credits_required|rate.?limit.*reject)/i;
const MODEL_UNAVAILABLE = /is not available (with|on) (the |your )?(claude )?\w+ plan|model .* (is not available|not found|does not exist)/i;
const AUTH = /(not logged in|please run \/login|run `?claude auth login|oauth token (has )?expired|invalid (api key|bearer)|authentication_error|login expired)/i;

/**
 * What a chunk's output means for the stage. `exitCode` and `stderr` come from the process: a crash or a refusal
 * before any session (unknown flag, no login) prints only there. The wording checks only read a chunk that failed:
 * a chunk that ended normally carries the agent's own prose, which may well talk about limits or logins.
 */
export function classifyClaudeChunk(
  summary: ClaudeStreamSummary,
  process: { exitCode: number | null; stderr: string; timedOut: boolean; foreign?: string[] }
): ClaudeChunkOutcome {
  const { result } = summary;
  if (process.foreign?.length) return { kind: "isolation", tools: process.foreign };
  if (summary.rateLimit) return { kind: "plan_limit", resetsAt: summary.rateLimit.resetsAt };
  const succeeded = Boolean(result && ((result.subtype === "success" && !result.isError) || result.subtype === "error_max_turns"));
  if (!succeeded) {
    const said = [result?.text ?? "", ...(result?.errors ?? []), summary.lastText, process.stderr].join("\n");
    if (result?.apiErrorStatus === 429 || PLAN_LIMIT.test(said)) return { kind: "plan_limit", resetsAt: null };
    if (MODEL_UNAVAILABLE.test(said)) return { kind: "model_unavailable", message: firstLine(said) };
    if (AUTH.test(said) || result?.apiErrorStatus === 401) return { kind: "auth", message: firstLine(said) };
  }
  if (process.timedOut) return { kind: "error", message: "Claude Code didn't finish this part of the stage in time." };
  const down = summary.init?.mcpServers.find((server) => server.name === MCP_SERVER_NAME && server.status !== "connected");
  if (down) return { kind: "error", message: `Claude Code couldn't reach TechTeam's tools (MCP ${down.status}).` };
  if (succeeded) return { kind: "ok" };
  const said = [result?.text ?? "", ...(result?.errors ?? []), summary.lastText].join("\n");
  if (result) return { kind: "error", message: firstLine(said) || `Claude Code stopped (${result.subtype}).` };
  return { kind: "error", message: firstLine(process.stderr) || `Claude Code exited with code ${process.exitCode ?? "unknown"}.` };
}

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 300) ?? ""
  );
}

/** Tools the session must not have: anything that isn't TechTeam's MCP server (isolation check on the init event). */
export function foreignTools(init: NonNullable<ClaudeStreamSummary["init"]>) {
  return init.tools.filter((tool) => !tool.startsWith(`mcp__${MCP_SERVER_NAME}__`));
}
