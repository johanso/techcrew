/**
 * A minimal Model Context Protocol server over Streamable HTTP, pure (app/api/mcp/runs/[runId] serves it): JSON-RPC
 * requests in, JSON responses out, no session and no event stream. Enough for a CLI agent that lists and calls tools;
 * the registry is generic so later tool sets (repository-backed knowledge, docs/cli-agents-plan.md §6) fit without a
 * new endpoint. Spec: https://modelcontextprotocol.io/specification (2025-06-18; older clients get their version back).
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type McpToolResult = { content: McpContent[]; isError?: boolean };

export type McpRegistry = {
  server: { name: string; version: string };
  instructions?: string;
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
};

/** A function tool (OpenAI's shape, which the agent tools use) as an MCP tool, with Claude Code's inline-result cap. */
export function mcpToolsFrom(tools: readonly { name: string; description?: string | null; parameters?: Record<string, unknown> | null }[], maxResultChars: number): McpTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.parameters ?? { type: "object", properties: {} },
    // Claude Code keeps a text result inline up to this size instead of saving it to a file (it has no file tools here).
    _meta: { "anthropic/maxResultSizeChars": maxResultChars },
  }));
}

type JsonRpcId = string | number;
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;

const isId = (value: unknown): value is JsonRpcId => typeof value === "string" || typeof value === "number";
const rec = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const failure = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Handles one JSON-RPC message. Notifications (no id) get no response (null): the route answers 202. A tool that
 * throws becomes a tool error result the model can read, not a protocol error, except for errors the caller rethrows
 * on purpose (`fatal`): those propagate so the route can refuse the request.
 */
export async function handleMcpMessage(registry: McpRegistry, message: unknown, fatal: (error: unknown) => boolean = () => false): Promise<JsonRpcResponse | null> {
  const msg = rec(message);
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return failure(isId(msg?.id) ? msg.id : null, JSONRPC_INVALID_REQUEST, "Invalid JSON-RPC request.");
  }
  if (!isId(msg.id)) return null;
  const id = msg.id;
  const params = rec(msg.params) ?? {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      const protocolVersion = requested && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: registry.server,
          ...(registry.instructions ? { instructions: registry.instructions } : {}),
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: await registry.listTools() } };
    case "tools/call": {
      if (typeof params.name !== "string") return failure(id, JSONRPC_INVALID_PARAMS, "tools/call needs a tool name.");
      const args = params.arguments === undefined ? {} : rec(params.arguments);
      if (!args) return failure(id, JSONRPC_INVALID_PARAMS, "Tool arguments must be an object.");
      try {
        return { jsonrpc: "2.0", id, result: await registry.callTool(params.name, args) };
      } catch (error) {
        if (fatal(error)) throw error;
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "the tool failed."}` }], isError: true } };
      }
    }
    default:
      return failure(id, JSONRPC_METHOD_NOT_FOUND, `Method ${msg.method} is not supported.`);
  }
}

/**
 * Handles a POST body: one message or a batch. Returns the JSON to send, or null when every message was a
 * notification (the route answers 202 Accepted with no body).
 */
export async function handleMcpBody(registry: McpRegistry, body: string, fatal?: (error: unknown) => boolean): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return failure(null, JSONRPC_PARSE_ERROR, "The body is not valid JSON.");
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return failure(null, JSONRPC_INVALID_REQUEST, "Empty batch.");
    const responses: JsonRpcResponse[] = [];
    for (const message of parsed) {
      const response = await handleMcpMessage(registry, message, fatal);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleMcpMessage(registry, parsed, fatal);
}
