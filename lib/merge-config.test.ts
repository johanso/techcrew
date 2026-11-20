import { describe, expect, it } from "vitest";

import {
  continuationNote,
  isBinaryContent,
  mergedMode,
  mergedReport,
  parsePendingMerge,
  parseResolveArgs,
  pendingReport,
  pickContinuedPullRequest,
  planMerge,
  routeConflict,
  type PendingMerge,
  type PlannedConflict,
  type TreeEntry,
} from "@/lib/merge-config";

const blob = (sha: string, mode = "100644"): TreeEntry => ({ mode, type: "blob", sha });

describe("planMerge", () => {
  const base = { "a.ts": blob("a0"), "b.ts": blob("b0"), "c.ts": blob("c0"), "d.ts": blob("d0"), "e.ts": blob("e0"), "f.ts": blob("f0") };

  it("keeps the default branch's tree and adds only what the branch changed", () => {
    const ours = { ...base, "a.ts": blob("a1"), "new.ts": blob("n1") } as Record<string, TreeEntry>;
    delete ours["f.ts"];
    const theirs = { ...base, "b.ts": blob("b2"), "theirs.ts": blob("t2") };
    expect(planMerge({ base, ours, theirs })).toEqual({
      take: [
        { path: "a.ts", mode: "100644", type: "blob", sha: "a1" },
        { path: "f.ts", mode: "100644", type: "blob", sha: null },
        { path: "new.ts", mode: "100644", type: "blob", sha: "n1" },
      ],
      conflicts: [],
    });
  });

  it("treats the same change on both sides as no change", () => {
    const both = { ...base, "c.ts": blob("c9") };
    expect(planMerge({ base, ours: both, theirs: both })).toEqual({ take: [], conflicts: [] });
  });

  it("reports paths both sides changed differently, including deletions and additions", () => {
    const ours = { ...base, "c.ts": blob("c1"), "d.ts": blob("d1"), "both.ts": blob("x1") } as Record<string, TreeEntry>;
    delete ours["e.ts"];
    const theirs = { ...base, "c.ts": blob("c2"), "e.ts": blob("e2"), "both.ts": blob("x2") } as Record<string, TreeEntry>;
    delete theirs["d.ts"];
    const { take, conflicts } = planMerge({ base, ours, theirs });
    expect(take).toEqual([]);
    expect(conflicts).toEqual([
      { path: "both.ts", base: null, ours: blob("x1"), theirs: blob("x2") },
      { path: "c.ts", base: blob("c0"), ours: blob("c1"), theirs: blob("c2") },
      { path: "d.ts", base: blob("d0"), ours: blob("d1"), theirs: null },
      { path: "e.ts", base: blob("e0"), ours: null, theirs: blob("e2") },
    ]);
  });

  it("counts a mode change as a change", () => {
    const ours = { ...base, "a.ts": blob("a0", "100755") };
    expect(planMerge({ base, ours, theirs: base }).take).toEqual([{ path: "a.ts", mode: "100755", type: "blob", sha: "a0" }]);
  });
});

describe("mergedMode", () => {
  it("keeps a side's mode change", () => {
    expect(mergedMode({ base: blob("x"), ours: blob("y", "100755"), theirs: blob("z") })).toBe("100755");
    expect(mergedMode({ base: blob("x"), ours: blob("y"), theirs: blob("z", "100755") })).toBe("100755");
    expect(mergedMode({ base: null, ours: null, theirs: blob("z") })).toBe("100644");
  });
});

describe("routeConflict", () => {
  const conflict = (path: string, sides: Partial<PlannedConflict> = {}): PlannedConflict => ({ path, base: blob("b"), ours: blob("o"), theirs: blob("t"), ...sides });

  it("gives text conflicts to the agent, as content or delete", () => {
    expect(routeConflict(conflict("src/app.ts"), [])).toEqual({ route: "agent", kind: "content" });
    expect(routeConflict(conflict("src/app.ts", { ours: null }), [])).toEqual({ route: "agent", kind: "delete" });
  });

  it("takes the default branch's lockfile", () => {
    for (const path of ["package-lock.json", "web/pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "go.sum"]) {
      expect(routeConflict(conflict(path), []), path).toEqual({ route: "lockfile" });
    }
  });

  it("refuses protected paths, links and submodules, and manifests without Manage dependencies", () => {
    expect(routeConflict(conflict(".github/workflows/ci.yml"), ["deps.manage"]).route).toBe("refused");
    expect(routeConflict(conflict(".env.local"), []).route).toBe("refused");
    expect(routeConflict(conflict("link", { ours: blob("o", "120000") }), []).route).toBe("refused");
    expect(routeConflict(conflict("vendor/lib", { theirs: { mode: "160000", type: "commit", sha: "c" } }), []).route).toBe("refused");
    expect(routeConflict(conflict("package.json"), ["code.write"])).toMatchObject({ route: "refused", reason: expect.stringContaining("Manage dependencies") });
    expect(routeConflict(conflict("package.json"), ["code.write", "deps.manage"])).toEqual({ route: "agent", kind: "content" });
    expect(routeConflict(conflict(".env.example"), [])).toEqual({ route: "agent", kind: "content" });
  });
});

describe("isBinaryContent", () => {
  it("flags NUL bytes and invalid UTF-8, not text", () => {
    expect(isBinaryContent(Buffer.from("héllo\n"))).toBe(false);
    expect(isBinaryContent(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(true);
    expect(isBinaryContent(Uint8Array.from([0x66, 0xff, 0x66]))).toBe(true);
  });
});

const pending: PendingMerge = {
  branch: "agent/san-2-totals",
  defaultBranch: "main",
  ours: "o".repeat(40),
  theirs: "abcdef1234567890".padEnd(40, "0"),
  base: "b".repeat(40),
  theirsTree: "t".repeat(40),
  take: [],
  autoMerged: ["src/util.ts"],
  lockfiles: ["package-lock.json"],
  conflicts: [
    { path: "src/app.ts", kind: "content", base: blob("1"), ours: blob("2"), theirs: blob("3"), resolution: { sha: "r", mode: "100644" } },
    { path: "src/old.ts", kind: "delete", base: blob("4"), ours: null, theirs: blob("5"), resolution: null },
  ],
  startedAt: "2026-11-20T00:00:00.000Z",
};

describe("parsePendingMerge", () => {
  it("reads a stored merge and rejects anything else", () => {
    expect(parsePendingMerge(JSON.parse(JSON.stringify(pending)))).toEqual(pending);
    expect(parsePendingMerge(null)).toBeNull();
    expect(parsePendingMerge({ ...pending, conflicts: "x" })).toBeNull();
    expect(parsePendingMerge({ ...pending, ours: 1 })).toBeNull();
  });
});

describe("tool answers", () => {
  it("list the conflicts and what's left, first line short", () => {
    const report = pendingReport(pending, { resumed: true, canAddDependency: true });
    expect(report.split("\n")[0]).toBe("A merge of main into agent/san-2-totals is in progress: 1 conflict left of 2.");
    expect(report).toContain("- src/app.ts: both changed it (resolved)");
    expect(report).toContain("- src/old.ts: your branch deleted it, main changed it");
    expect(report).toContain("Merged automatically (both changed them, in different places): src/util.ts.");
    expect(report).toContain("call add_dependency for each");
    expect(pendingReport(pending, { resumed: false, canAddDependency: false })).toContain("say so in your summary");
  });

  it("confirm the merge commit", () => {
    const report = mergedReport({ ...pending, commit: "1234567890abcdef", resolved: ["src/app.ts"], autoMerged: [], lockfiles: [], canAddDependency: false });
    expect(report.split("\n")[0]).toBe("Merged main (abcdef1) into agent/san-2-totals: commit 1234567; resolved 1 conflict (src/app.ts).");
  });
});

describe("parseResolveArgs", () => {
  it("takes a path and the whole file, or null to delete", () => {
    expect(parseResolveArgs({ path: "./src/a.ts", content: "x\n" })).toEqual({ ok: true, path: "src/a.ts", content: "x\n" });
    expect(parseResolveArgs({ path: "src/a.ts", content: null })).toEqual({ ok: true, path: "src/a.ts", content: null });
    expect(parseResolveArgs({ path: "", content: "x" }).ok).toBe(false);
    expect(parseResolveArgs({ path: "a", content: 3 }).ok).toBe(false);
    expect(parseResolveArgs({ path: "a", content: "x".repeat(200_001) }).ok).toBe(false);
  });
});

describe("pickContinuedPullRequest", () => {
  const pr = (id: number, taskId: number | null, followUpTaskId: number | null, day: number) => ({ id, taskId, followUpTaskId, createdAt: new Date(2026, 10, day) });

  it("prefers the card's own newest pull request", () => {
    expect(pickContinuedPullRequest(5, [pr(1, 5, null, 1), pr(2, 5, null, 3), pr(3, 9, 5, 4)])).toEqual({ pr: pr(2, 5, null, 3), via: "own" });
  });

  it("falls back to the pull request the card is the follow-up of", () => {
    expect(pickContinuedPullRequest(5, [pr(3, 9, 5, 4), pr(4, 8, null, 5)])).toEqual({ pr: pr(3, 9, 5, 4), via: "follow_up" });
  });

  it("finds nothing for an unrelated card", () => {
    expect(pickContinuedPullRequest(5, [pr(4, 8, null, 5), pr(6, 7, 8, 6)])).toBeNull();
  });
});

describe("continuationNote", () => {
  const input = { prNumber: 2, branch: "agent/san-2-totals", defaultBranch: "main", mergeError: null, conflict: false };

  it("tells the developer of a follow-up card whose pull request it continues, and to merge main first", () => {
    const note = continuationNote({
      ...input,
      stage: "development",
      origin: { key: "SAN-2", title: "Show totals", description: "Add a totals row." },
      mergeError: "Merge conflict: agent/san-2-totals conflicts with main.",
    });
    expect(note).toContain("This card is the follow-up of SAN-2: its pull request #2 (branch agent/san-2-totals) couldn't be merged.");
    expect(note).toContain("<original-card>\nTitle: Show totals\nAdd a totals row.\n</original-card>");
    expect(note).toContain("Start with merge_default_branch");
  });

  it("keeps a rerun's note and adds the merge only when there is a conflict", () => {
    const rerun = continuationNote({ ...input, stage: "development", origin: null });
    expect(rerun).toContain("This card was run before.");
    expect(rerun).not.toContain("merge_default_branch");
    expect(continuationNote({ ...input, stage: "development", origin: null, conflict: true })).toContain("Start with merge_default_branch");
  });

  it("tells the analyst what the developer will do", () => {
    const note = continuationNote({ ...input, stage: "analysis", origin: null, conflict: true });
    expect(note).toContain("The Developer starts with merge_default_branch");
    expect(note).not.toContain("Start with");
  });

  it("clips a long original description", () => {
    const note = continuationNote({ ...input, stage: "analysis", origin: { key: "SAN-2", title: "t", description: "x".repeat(5000) } });
    expect(note.length).toBeLessThan(2500);
  });
});
