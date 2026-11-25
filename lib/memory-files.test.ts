import { describe, expect, it } from "vitest";

import { CORE_FILE, serializeNote, type MemoryNote } from "@/lib/memory-config";
import {
  isMemoryBranch,
  isMemoryFilePath,
  memoryBranchName,
  memoryFileOfKey,
  memoryPrBody,
  memoryPrTitle,
  memoryTreeEntries,
  noteFileName,
  planMemoryCommit,
  type CommitProposal,
  type MemoryTree,
} from "@/lib/memory-files";
import { noteVersion } from "@/lib/memory-hash";
import { loadRepoNotes } from "@/lib/memory-loader";
import { pathWriteRefusal } from "@/lib/repo-paths";

const note = (key: string, over: Partial<MemoryNote> = {}): MemoryNote => ({
  key,
  scope: "project",
  userId: 1,
  workspaceId: 10,
  id: null,
  file: `.techteam/memory/notes/${key.slice(8)}.md`,
  type: "pitfall",
  title: key.slice(8),
  body: `About ${key}.`,
  load: "on_demand",
  status: "active",
  paths: [],
  source: {},
  origin: "owner",
  ...over,
});

const tree = (notes: MemoryNote[] = [], names: string[] = notes.map((n) => n.file!.split("/").pop()!.toLowerCase()), coreExists = false): MemoryTree => ({
  notes,
  names: new Set(names),
  coreExists,
});

const text = (title: string, over = {}) => ({ title, type: "convention" as const, load: "on_demand" as const, paths: [] as string[], body: `Body of ${title}.`, ...over });
const add = (id: number, title: string, over = {}): CommitProposal => ({ id, kind: "add", targetKey: null, target: null, note: text(title, over), origin: "agent" });
const change = (id: number, kind: "update" | "retire", of: MemoryNote, body = "New body."): CommitProposal => ({
  id,
  kind,
  targetKey: of.key,
  target: { version: noteVersion(of), note: text(of.title) },
  note: kind === "retire" ? null : text(of.title, { body }),
  origin: "agent",
});

describe("the path guard", () => {
  it("allows only the core file and plain note files", () => {
    for (const path of [CORE_FILE, ".techteam/memory/notes/tests.md", ".techteam/memory/notes/Api_v2.1-rules.md"]) expect(isMemoryFilePath(path), path).toBe(true);
    for (const path of [
      "README.md",
      ".techteam/memory/README.md",
      ".techteam/memory/notes/../../../README.md",
      ".techteam/memory/notes/..md",
      ".techteam/memory/notes/a/b.md",
      ".techteam/memory/notes/.hidden.md",
      ".techteam/memory/notes/x.yml",
      ".techteam/memory/notes/",
      ".techteam/memory/notes\\x.md",
      "/.techteam/memory/notes/x.md",
      "./.techteam/memory/notes/x.md",
      ".techteam/notes/x.md",
      ".github/workflows/ci.yml",
      ".techteam/memory/../../.github/workflows/ci.yml",
      ".techteam/memory/notes/x.md\n.env",
      ".techteam/memory/notes/x.md\u0000",
      ".techteam/memory/notes/con.md",
      "src/.techteam/memory/notes/x.md",
    ]) {
      expect(isMemoryFilePath(path), JSON.stringify(path)).toBe(false);
    }
  });

  it("refuses to build a commit with any other path, or the same one twice", () => {
    expect(memoryTreeEntries([{ path: CORE_FILE, sha: "a" }, { path: ".techteam/memory/notes/x.md", sha: null }])).toEqual([
      { path: CORE_FILE, mode: "100644", type: "blob", sha: "a" },
      { path: ".techteam/memory/notes/x.md", mode: "100644", type: "blob", sha: null },
    ]);
    expect(() => memoryTreeEntries([{ path: CORE_FILE, sha: "a" }, { path: "package.json", sha: "b" }])).toThrow(/can't write/);
    expect(() => memoryTreeEntries([{ path: ".techteam/memory/notes/X.md", sha: "a" }, { path: ".techteam/memory/notes/x.md", sha: "b" }])).toThrow(/twice/);
  });

  it("names a note's file from its key, never outside the folder", () => {
    expect(memoryFileOfKey("project/conventions")).toBe(CORE_FILE);
    expect(memoryFileOfKey("project/lint")).toBe(".techteam/memory/notes/lint.md");
    for (const key of ["global/x-1", "project/", "project/../../x", "project/a/b"]) expect(memoryFileOfKey(key), key).toBeNull();
  });

  it("leaves the folder closed to the agents' own write tools", () => {
    expect(pathWriteRefusal(CORE_FILE, ["code.write", "deps.manage"])).toContain("protected");
  });

  it("names branches by date and recognizes only its own", () => {
    const date = new Date("2026-11-25T23:59:00Z");
    expect(memoryBranchName(date)).toBe("agent/memory-2026-11-25");
    expect(memoryBranchName(date, 3)).toBe("agent/memory-2026-11-25-3");
    expect(isMemoryBranch("agent/memory-2026-11-25-3")).toBe(true);
    for (const other of ["main", "agent/acm-1-memory", "agent/memory-x", "feature/agent/memory-2026-11-25"]) expect(isMemoryBranch(other), other).toBe(false);
  });

  it("makes free, safe file names", () => {
    expect(noteFileName("Run the tests!", new Set())).toBe("run-the-tests.md");
    expect(noteFileName("Run the tests!", new Set(["run-the-tests.md", "run-the-tests-2.md"]))).toBe("run-the-tests-3.md");
    expect(noteFileName("Conventions", new Set())).toBe("conventions-note.md");
    expect(noteFileName("CON", new Set())).toBe("con-note.md");
    expect(noteFileName("../../etc", new Set())).toBe("etc.md");
    expect(noteFileName("¿?", new Set())).toBe("note.md");
  });
});

describe("the commit", () => {
  const existing = note("project/lint", { title: "Lint" });

  it("writes the conventions to the core file once, other notes to notes/, and reads back", async () => {
    const core = add(1, "Project conventions", { load: "always" });
    const second = add(2, "More conventions", { load: "always" });
    const plan = planMemoryCommit([second, core, add(3, "Tests", { paths: ["src/**/*.test.ts"] })], tree(), tree());
    expect(plan.files.map((f) => f.path)).toEqual([CORE_FILE, ".techteam/memory/notes/more-conventions.md", ".techteam/memory/notes/tests.md"]);
    const files = new Map(plan.files.map((f) => [f.path, f.content!]));
    const loaded = await loadRepoNotes(
      {
        listDir: async (dir) => [...files.keys()].filter((p) => p.slice(0, p.lastIndexOf("/")) === dir).map((p) => ({ name: p.slice(dir.length + 1), size: 100 })),
        readFile: async (path) => files.get(path) ?? null,
      },
      { userId: 1, workspaceId: 10 }
    );
    expect(loaded.skipped).toEqual([]);
    expect(loaded.notes.map((n) => [n.key, n.load, n.source])).toEqual([
      ["project/conventions", "always", { kind: "agent", proposal: 1 }],
      ["project/more-conventions", "always", { kind: "agent", proposal: 2 }],
      ["project/tests", "on_demand", { kind: "agent", proposal: 3 }],
    ]);
    expect(loaded.notes[2]!.paths).toEqual(["src/**/*.test.ts"]);
  });

  it("keeps quotes, colons and headings in a note's text", () => {
    const tricky = add(1, 'Say "no": # really', { body: "---\n# Heading\nkey: value\n```\ncode\n```" });
    const plan = planMemoryCommit([tricky], tree(), tree());
    expect(plan.superseded).toEqual([]);
    expect(plan.files[0]!.content).toBe(serializeNote({ ...tricky.note!, status: "active", source: { kind: "agent", proposal: 1 } }));
  });

  it("never overwrites an existing core file or note name", () => {
    const plan = planMemoryCommit([add(1, "Conventions of ours", { load: "always" }), add(2, "Lint!", { body: "Different." }), add(3, "Fresh")], tree([existing], ["lint.md", "fresh.md"], true), tree());
    expect(plan.files.map((f) => f.path)).toEqual([".techteam/memory/notes/conventions-of-ours.md", ".techteam/memory/notes/fresh-2.md"]);
    expect(plan.superseded).toEqual([{ id: 2, reason: "A note in the repository already says this." }]);
  });

  it("updates and deletes the target's own file", () => {
    const other = note("project/ci", { title: "CI" });
    const plan = planMemoryCommit([change(1, "update", existing), change(2, "retire", other)], tree([existing, other]), tree([existing, other]));
    expect(plan.files.map((f) => [f.path, f.content === null])).toEqual([
      [".techteam/memory/notes/lint.md", false],
      [".techteam/memory/notes/ci.md", true],
    ]);
    expect(plan.files[0]!.content).toContain("New body.");
  });

  it("supersedes a change when the note changed or went, on the default branch or the pull request's", () => {
    const changed = { ...existing, body: "Someone edited it." };
    for (const [base, branch] of [
      [tree([changed]), tree([changed])],
      [tree([]), tree([])],
      [tree([changed]), tree([existing])],
      [tree([existing]), tree([changed])],
      [tree([existing]), tree([])],
      [tree([{ ...existing, status: "disabled" as const }]), tree([existing])],
    ]) {
      for (const kind of ["update", "retire"] as const) {
        const plan = planMemoryCommit([change(1, kind, existing)], base!, branch!);
        expect(plan.files).toEqual([]);
        expect(plan.superseded).toEqual([{ id: 1, reason: "The note changed or is gone since this was proposed." }]);
      }
    }
  });

  it("changes a file once, and refuses a file name it can't write", () => {
    const twice = planMemoryCommit([change(1, "update", existing), change(2, "retire", existing)], tree([existing]), tree([existing]));
    expect(twice.included.map((i) => i.id)).toEqual([1]);
    expect(twice.superseded[0]).toMatchObject({ id: 2 });
    const odd = note("project/odd", { file: ".techteam/memory/notes/a..b.md" });
    expect(planMemoryCommit([change(1, "retire", odd)], tree([odd]), tree([odd])).files).toEqual([]);
  });
});

describe("the pull request's words", () => {
  const body = memoryPrBody(
    [
      {
        kind: "add",
        path: ".techteam/memory/notes/x.md",
        title: "Ping @octocat `now`",
        body: "```\n@octocat <img src=x>\n```",
        rationale: "Said @octocat.",
        evidence: [
          { kind: "pr_rejected", signalId: 1, trusted: true, summary: "THE-OWNERS-WORDS", taskId: 7, prNumber: 12 },
          { kind: "repository", trusted: false, files: ["README.md"] },
        ],
        untrustedOrigin: true,
      },
    ],
    new Map([[7, "ACM-7"]])
  );

  it("lists the notes, why and what they rest on, without the signals' own words", () => {
    expect(memoryPrTitle(1)).toBe("TechTeam memory: 1 note");
    expect(memoryPrTitle(3)).toBe("TechTeam memory: 3 notes");
    expect(body).toContain("Pull request rejected (typed by the owner): card `ACM-7`, #12");
    expect(body).toContain("Repository files: `README.md`");
    expect(body).toContain("Based only on text from agents, CI or the repository");
    expect(body).not.toContain("THE-OWNERS-WORDS");
  });

  it("keeps every text inside code, so nothing is mentioned or rendered", () => {
    expect(body).toContain("````\n```\n@octocat <img src=x>\n```\n````");
    const outside = body.replace(/(`{3,})\n[\s\S]*?\n\1/g, "").replace(/`[^`\n]*`/g, "");
    expect(outside).not.toContain("@");
    expect(outside).not.toContain("<img");
  });

  it("stays under GitHub's limit", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ kind: "add" as const, path: `p${i}`, title: "t", body: "b".repeat(2000), rationale: "r", evidence: [], untrustedOrigin: false }));
    expect(memoryPrBody(many).length).toBeLessThan(65_536);
    expect(memoryPrBody(many)).toContain("more, shown in the files");
  });
});
