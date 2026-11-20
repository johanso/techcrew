import { describe, expect, it } from "vitest";

import { JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND, JSONRPC_PARSE_ERROR, handleMcpBody, handleMcpMessage, type McpRegistry } from "@/lib/mcp-protocol";

class Fatal extends Error {}

const registry: McpRegistry = {
  server: { name: "techteam", version: "0.8.0" },
  instructions: "Use the tools.",
  listTools: async () => [{ name: "read_file", description: "Reads a file.", inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
  callTool: async (name, args) => {
    if (name === "explode") throw new Error("boom");
    if (name === "revoked") throw new Fatal("token revoked");
    return { content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] };
  },
};

const call = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

describe("handleMcpMessage", () => {
  it("initializes with the client's version when supported, else the latest", async () => {
    const known = await handleMcpMessage(registry, call("initialize", { protocolVersion: "2025-06-18", capabilities: {} }));
    expect(known).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "techteam" }, instructions: "Use the tools." } });
    const unknown = await handleMcpMessage(registry, call("initialize", { protocolVersion: "1999-01-01" }));
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("answers ping and lists tools", async () => {
    expect(await handleMcpMessage(registry, call("ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(await handleMcpMessage(registry, call("tools/list"))).toMatchObject({ result: { tools: [{ name: "read_file" }] } });
  });

  it("calls a tool with its arguments", async () => {
    expect(await handleMcpMessage(registry, call("tools/call", { name: "read_file", arguments: { path: "a.ts" } }))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: 'read_file:{"path":"a.ts"}' }] },
    });
  });

  it("turns a failing tool into an error result the model can read", async () => {
    expect(await handleMcpMessage(registry, call("tools/call", { name: "explode" }))).toMatchObject({ result: { isError: true, content: [{ text: "Error: boom" }] } });
  });

  it("rethrows errors the route must handle", async () => {
    await expect(handleMcpMessage(registry, call("tools/call", { name: "revoked" }), (e) => e instanceof Fatal)).rejects.toThrow("token revoked");
  });

  it("refuses bad params and unknown methods", async () => {
    expect(await handleMcpMessage(registry, call("tools/call", { arguments: {} }))).toMatchObject({ error: { code: JSONRPC_INVALID_PARAMS } });
    expect(await handleMcpMessage(registry, call("tools/call", { name: "x", arguments: [1] }))).toMatchObject({ error: { code: JSONRPC_INVALID_PARAMS } });
    expect(await handleMcpMessage(registry, call("resources/list"))).toMatchObject({ error: { code: JSONRPC_METHOD_NOT_FOUND } });
  });

  it("gives notifications no response", async () => {
    expect(await handleMcpMessage(registry, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});

describe("handleMcpBody", () => {
  it("reports a parse error", async () => {
    expect(await handleMcpBody(registry, "{nope")).toMatchObject({ id: null, error: { code: JSONRPC_PARSE_ERROR } });
  });

  it("answers a batch, skipping notifications", async () => {
    const body = JSON.stringify([call("ping", undefined, "a"), { jsonrpc: "2.0", method: "notifications/initialized" }, call("tools/list", undefined, "b")]);
    const responses = await handleMcpBody(registry, body);
    expect(Array.isArray(responses) && responses.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns null when there's nothing to answer", async () => {
    expect(await handleMcpBody(registry, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull();
  });
});
