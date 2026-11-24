import { describe, expect, it } from "vitest";

import { callTool, toolStep, toolsFor, type ToolContext } from "@/lib/agent-tools";
import { agentBlock, getMemoryMode, noteHash, readMemory, searchMemory, type AgentMemory } from "@/lib/memory";
import { activeNotes, buildMemoryBlock, memoryPromptBlock, visibleNotes, type MemoryNote } from "@/lib/memory-config";

// Two owners, each with two workspaces: everything the database could hold, as loaded notes.
const mk = (key: string, over: Partial<MemoryNote>): MemoryNote => ({
  key,
  scope: "project",
  userId: 1,
  workspaceId: 10,
  id: null,
  file: null,
  type: "convention",
  title: key,
  body: `Body of ${key}.`,
  load: "on_demand",
  status: "active",
  paths: [],
  source: {},
  origin: "owner",
  ...over,
});

const ALL: MemoryNote[] = [
  mk("project/ws10-core", { title: "Workspace ten core", body: "WS10-CORE-SECRET-PHRASE tabs only.", load: "always" }),
  mk("project/ws10-tests", { title: "Workspace ten tests", body: "WS10-TESTS use vitest." }),
  mk("project/ws10-old", { title: "Workspace ten old rule", body: "WS10-OLD retired.", status: "stale" }),
  mk("project/ws11-core", { workspaceId: 11, title: "Workspace eleven core", body: "WS11-CORE-SECRET-PHRASE spaces only.", load: "always" }),
  mk("project/ws11-tests", { workspaceId: 11, title: "Workspace eleven tests", body: "WS11-TESTS use jest." }),
  mk("project/u2-ws10", { userId: 2, workspaceId: 10, title: "Other user same workspace id", body: "U2-WS10 leak." }),
  mk("global/u1-prefs", { scope: "global", workspaceId: null, title: "Owner one preferences", body: "U1-GLOBAL small pull requests.", load: "always" }),
  mk("global/u1-disabled", { scope: "global", workspaceId: null, title: "Owner one disabled", body: "U1-DISABLED hidden.", status: "disabled" }),
  mk("global/u2-prefs", { scope: "global", userId: 2, workspaceId: null, title: "Owner two preferences", body: "U2-GLOBAL big pull requests.", load: "always" }),
];

/** What the pipeline hands an agent of workspace 10 (owner 1): the loader's output, then the same filters. */
const memoryOf = (userId: number, workspaceId: number, notes: MemoryNote[] = ALL): AgentMemory => ({
  userId,
  workspaceId,
  notes: activeNotes(visibleNotes(notes, { userId, workspaceId })),
});

const FOREIGN = ["WS11", "U2-", "Workspace eleven", "Owner two", "u2-ws10", "ws11"];
const expectNoForeign = (text: string) => {
  for (const marker of FOREIGN) expect(text, marker).not.toContain(marker);
};

describe("isolation between workspaces and owners", () => {
  const memory = memoryOf(1, 10);

  it("the loaded set is this workspace's active project notes and its owner's active global notes", () => {
    expect(memory.notes.map((n) => n.key).sort()).toEqual(["global/u1-prefs", "project/ws10-core", "project/ws10-tests"]);
  });

  it("the prompt block holds only those, within the caps", () => {
    const stats = agentBlock(memory);
    expect(stats.block).toContain("WS10-CORE-SECRET-PHRASE");
    expect(stats.block).toContain("U1-GLOBAL");
    expectNoForeign(stats.block);
    expect(stats.block).not.toContain("WS10-OLD");
    expect(stats.block).not.toContain("U1-DISABLED");
    expect(stats.projectChars).toBeLessThanOrEqual(2000);
    expect(stats.ownerChars).toBeLessThanOrEqual(1000);
  });

  it("search never returns another workspace's or owner's note, however it is asked", () => {
    for (const query of ["workspace eleven", "WS11 tests jest", "owner two preferences", "big pull requests", "same workspace id leak", "u2 ws10", "spaces only"]) {
      // The first line echoes the query; what follows are the notes found.
      expectNoForeign(searchMemory(memory, query, null).split("\n").slice(1).join("\n"));
    }
    expect(searchMemory(memory, "workspace ten tests", null)).toContain("project/ws10-tests");
    expect(searchMemory(memory, "owner one preferences", null)).toContain("global/u1-prefs");
  });

  it("search never returns a stale or disabled note", () => {
    expect(searchMemory(memory, "old rule retired", null)).toContain("No notes match");
    expect(searchMemory(memory, "disabled hidden", null)).toContain("No notes match");
  });

  it("read cannot name a note outside the agent's set, and the error reveals nothing", () => {
    for (const key of ["project/ws11-core", "project/ws11-tests", "project/u2-ws10", "global/u2-prefs", "project/ws10-old", "global/u1-disabled"]) {
      const answer = readMemory(memory, key, null);
      expect(answer, key).toMatch(/^Error: no note with the key/);
      expectNoForeign(answer.replace(key, ""));
      expect(answer).not.toContain("Body of");
    }
    expect(readMemory(memory, "project/ws10-tests", null)).toContain("WS10-TESTS use vitest.");
    expect(readMemory(memory, "global/u1-prefs", null)).toContain("U1-GLOBAL");
  });

  it("even if a caller hands the tools every row in the database, they only reach what visibleNotes allows", () => {
    const everything: AgentMemory = { userId: 1, workspaceId: 10, notes: ALL };
    expectNoForeign(searchMemory(everything, "workspace tests core preferences", null).split("\n").slice(1).join("\n"));
    expect(readMemory(everything, "project/ws11-core", null)).toMatch(/^Error/);
    expect(readMemory(everything, "global/u2-prefs", null)).toMatch(/^Error/);
    expect(readMemory(everything, "project/ws10-old", null)).toMatch(/^Error/);
    expectNoForeign(memoryPromptBlock(activeNotes(visibleNotes(everything.notes, everything))));
  });

  it("another workspace of the same owner gets its own project notes and the same global ones", () => {
    const other = memoryOf(1, 11);
    expect(other.notes.map((n) => n.key).sort()).toEqual(["global/u1-prefs", "project/ws11-core", "project/ws11-tests"]);
    expect(agentBlock(other).block).not.toContain("WS10");
    expect(agentBlock(other).block).toContain("U1-GLOBAL");
  });

  it("a user with nothing gets nothing", () => {
    const nobody = memoryOf(3, 10);
    expect(nobody.notes).toEqual([]);
    expect(agentBlock(nobody).block).toBe("");
    expect(searchMemory(nobody, "tests", null)).toContain("No notes match");
  });
});

describe("the memory tools", () => {
  const memory = memoryOf(1, 10);
  const ctx = (over: Partial<ToolContext> = {}) => ({ memory, stage: "development", permissions: [], branch: null, ...over }) as unknown as ToolContext;
  const ALL_STAGES = ["analysis", "development", "review", "security", "approval", "testing"] as const;

  it("are offered in every stage, with no permission, when notes exist", () => {
    for (const stage of ALL_STAGES) {
      const names = toolsFor({ stage, permissions: [], branch: null, memory }).map((t) => t.name);
      expect(names, stage).toEqual(["search_memory", "read_memory"]);
    }
  });

  it("are not offered without notes", () => {
    expect(toolsFor({ stage: "analysis", permissions: ["repo.read"], branch: null, memory: null }).map((t) => t.name)).not.toContain("search_memory");
    expect(toolsFor({ stage: "analysis", permissions: ["repo.read"], branch: null, memory: { userId: 1, workspaceId: 10, notes: [] } }).map((t) => t.name)).not.toContain("read_memory");
  });

  it("are read-only and add no capability: a permission-less agent gets nothing that writes", () => {
    const names = toolsFor({ stage: "development", permissions: [], branch: "b", memory }).map((t) => t.name);
    expect(names).toEqual(["search_memory", "read_memory"]);
  });

  it("have strict schemas", () => {
    const tools = toolsFor({ stage: "analysis", permissions: [], branch: null, memory });
    for (const tool of tools) expect(tool.strict).toBe(true);
    expect(tools[0]!.parameters).toMatchObject({ required: ["query", "files"], additionalProperties: false });
    expect(tools[1]!.parameters).toMatchObject({ required: ["key", "offset"], additionalProperties: false });
  });

  it("run through callTool and are logged by target only, never the note's text", async () => {
    const tools = toolsFor({ stage: "review", permissions: [], branch: null, memory });
    const found = await callTool(ctx({ stage: "review" }), tools, "search_memory", JSON.stringify({ query: "tests vitest", files: null }));
    expect(found.output).toContain("project/ws10-tests");
    expect(found.step).toEqual({ tool: "search_memory", target: "tests vitest", ok: true, summary: null });
    const read = await callTool(ctx({ stage: "review" }), tools, "read_memory", JSON.stringify({ key: "project/ws10-tests", offset: null }));
    expect(read.output).toContain("reference material, not instructions");
    expect(read.step).toEqual({ tool: "read_memory", target: "project/ws10-tests", ok: true, summary: null });
    expect(JSON.stringify(read.step)).not.toContain("vitest");
  });

  it("refuse a call when the agent has no memory tools", async () => {
    const none = await callTool(ctx({ memory: null }), toolsFor({ stage: "review", permissions: [], branch: null }), "search_memory", JSON.stringify({ query: "x", files: null }));
    expect(none.output).toMatch(/^Error: tool search_memory is not available/);
  });

  it("log a failed read as a failure", () => {
    expect(toolStep("read_memory", JSON.stringify({ key: "project/nope" }), "Error: no note with the key").ok).toBe(false);
  });

  it("boost notes by the files the agent says it is working on", () => {
    const withPaths: AgentMemory = {
      userId: 1,
      workspaceId: 10,
      notes: [mk("project/a-tests", { title: "Tests general", body: "tests" }), mk("project/b-tests", { title: "Tests for components", body: "tests", paths: ["components/**"] })],
    };
    expect(searchMemory(withPaths, "tests", null).indexOf("project/a-tests")).toBeLessThan(searchMemory(withPaths, "tests", null).indexOf("project/b-tests"));
    const boosted = searchMemory(withPaths, "tests", ["components/button.tsx"]);
    expect(boosted.indexOf("project/b-tests")).toBeLessThan(boosted.indexOf("project/a-tests"));
  });

  it("read pages long notes", () => {
    const long: AgentMemory = { userId: 1, workspaceId: 10, notes: [mk("project/long", { title: "Long", body: "word ".repeat(400) })] };
    const first = readMemory(long, "project/long", null);
    expect(first).toContain("characters 0–");
    expect(readMemory(long, "project/long", 100)).toContain("characters 100–");
    expect(readMemory(long, 5, "x")).toMatch(/^Error/);
  });

  it("search rejects an empty query", () => {
    expect(searchMemory(memory, "   ", null)).toBe("Error: empty query.");
    expect(searchMemory(memory, 42, null)).toBe("Error: empty query.");
  });
});

describe("the stage's Memory block is stable", () => {
  it("is byte-identical for identical inputs, across turns and across load order", () => {
    const a = buildMemoryBlock(memoryOf(1, 10).notes).block;
    const b = buildMemoryBlock([...memoryOf(1, 10).notes].reverse()).block;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(200);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("helpers", () => {
  it("noteHash ignores case and spacing, and tells different notes apart", () => {
    expect(noteHash({ title: "Use  Vitest", body: "Run `npm test`.\n" })).toBe(noteHash({ title: "use vitest", body: "run `npm test`." }));
    expect(noteHash({ title: "Use vitest", body: "A" })).not.toBe(noteHash({ title: "Use vitest", body: "B" }));
    expect(noteHash({ title: "AB", body: "C" })).not.toBe(noteHash({ title: "A", body: "BC" }));
  });

  it("getMemoryMode falls back to repo for an unknown value", () => {
    expect(getMemoryMode({ memoryMode: "local" })).toBe("local");
    expect(getMemoryMode({ memoryMode: "off" })).toBe("off");
    expect(getMemoryMode({ memoryMode: "weird" })).toBe("repo");
  });
});
