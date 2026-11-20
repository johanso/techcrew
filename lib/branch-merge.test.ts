import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// A local git repository stands in for GitHub: every API call the merge tools make maps onto git plumbing, so the
// merge commit, its tree and its parents are checked by git itself. No network, no database (an in-memory row).
const repoDir = mkdtempSync(join(tmpdir(), "merge-git-"));
const git = (args: string[], input?: string, env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd: repoDir, input, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...env } }).toString();

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
let stored: unknown = null;
vi.mock("@/db", () => ({
  agentRuns: { pendingMerge: "pending_merge", id: "id" },
  db: {
    select: () => ({ from: () => ({ where: async () => [{ pending: stored }] }) }),
    update: () => ({ set: (values: { pendingMerge: unknown }) => ({ where: async () => { stored = JSON.parse(JSON.stringify(values.pendingMerge)); } }) }),
  },
}));
vi.mock("@/lib/github", () => {
  class GithubError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  return {
    GithubError,
    getBranchSha: async (_t: string, _r: string, branch: string) => git(["rev-parse", `refs/heads/${branch}`]).trim(),
    getCommit: async (_t: string, _r: string, sha: string) => {
      const text = git(["cat-file", "-p", sha]);
      return { sha, treeSha: /^tree (\w+)/m.exec(text)![1]!, parents: [...text.matchAll(/^parent (\w+)/gm)].map((m) => m[1]!) };
    },
    getTreeEntries: async (_t: string, _r: string, tree: string) => {
      const entries: Record<string, { mode: string; type: "blob" | "commit"; sha: string; size?: number }> = {};
      for (const line of git(["ls-tree", "-r", "-l", tree]).trim().split("\n")) {
        const [meta, path] = line.split("\t");
        const [mode, type, sha, size] = meta!.split(/\s+/);
        entries[path!] = { mode: mode!, type: type as "blob", sha: sha!, size: Number(size) };
      }
      return { entries, truncated: false };
    },
    getBlob: async (_t: string, _r: string, sha: string) => execFileSync("git", ["cat-file", "blob", sha], { cwd: repoDir, stdio: "pipe" }),
    createBlob: async (_t: string, _r: string, content: string) => { return git(["hash-object", "-w", "--stdin"], content).trim(); },
    getMergeBase: async (_t: string, _r: string, a: string, b: string) => git(["merge-base", a, b]).trim(),
    mergeIntoBranch: async (_t: string, _r: string, input: { base: string; head: string }) => {
      try { git(["merge-tree", "--write-tree", `refs/heads/${input.base}`, input.head]); } catch { return { status: "conflict" }; }
      throw new Error("expected a conflict in this scenario");
    },
    commitTree: async (_t: string, _r: string, input: { branch: string; baseTreeSha: string; entries: { path: string; mode: string; type: string; sha: string | null }[]; parents: string[]; message: string }) => {
      const index = join(repoDir, ".git", "tmp-index");
      const env = { GIT_INDEX_FILE: index };
      git(["read-tree", input.baseTreeSha], undefined, env);
      for (const e of input.entries) {
        if (e.sha === null) git(["update-index", "--force-remove", e.path], undefined, env);
        else git(["update-index", "--add", "--cacheinfo", `${e.mode},${e.sha},${e.path}`], undefined, env);
      }
      const tree = git(["write-tree"], undefined, env).trim();
      rmSync(index);
      const commit = git(["commit-tree", tree, ...input.parents.flatMap((p) => ["-p", p]), "-m", input.message]).trim();
      git(["update-ref", `refs/heads/${input.branch}`, commit, input.parents[0]!]); // fast-forward only
      return commit;
    },
  };
});

afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

const { mergeDefaultBranch, readConflict, resolveConflict, finishMerge, mergeWriteBlock } = await import("@/lib/branch-merge");

function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), content);
  }
}
const lines = (n: number, tag = "") => Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join("\n") + "\n";
const commitAll = (message: string) => { git(["add", "-A"]); git(["commit", "-q", "-m", message]); return git(["rev-parse", "HEAD"]).trim(); };

describe("merge tools against a real git repository", () => {
  it("merges main into a conflicted branch as a two-parent commit git accepts", async () => {
    git(["init", "-q", "-b", "main"]);
    write({
      "src/app.ts": lines(10),
      "src/util.ts": lines(12),
      "src/old.ts": "export const old = 1;\n",
      "package-lock.json": '{ "lockfileVersion": 3, "v": "base" }\n',
      "bin/run.sh": "echo run\n",
      ".github/workflows/ci.yml": "on: push\n",
    });
    commitAll("base");
    git(["checkout", "-q", "-b", "agent/san-2-totals"]);
    write({
      "src/app.ts": lines(10).replace("line 3\n", "line 3 ours\n"),
      "src/util.ts": lines(12).replace("line 1\n", "line 1 ours\n"),
      "src/old.ts": "export const old = 2; // ours\n",
      "package-lock.json": '{ "lockfileVersion": 3, "v": "ours" }\n',
      "src/feature.ts": "export const feature = true;\n",
    });
    chmodSync(join(repoDir, "bin/run.sh"), 0o755);
    const ours = commitAll("ours");
    git(["checkout", "-q", "main"]);
    write({
      "src/app.ts": lines(10).replace("line 3\n", "line 3 theirs\n").replace("line 8\n", "line 8 theirs\n"),
      "src/util.ts": lines(12).replace("line 12\n", "line 12 theirs\n"),
      "package-lock.json": '{ "lockfileVersion": 3, "v": "theirs" }\n',
      "docs/main.md": "# main\n",
    });
    rmSync(join(repoDir, "src/old.ts"));
    const theirs = commitAll("theirs");

    const ctx = { token: "t", repo: "o/r", defaultBranch: "main", branch: "agent/san-2-totals", runId: 1, permissions: ["repo.read", "code.write"] as never, canAddDependency: false };
    const started = await mergeDefaultBranch(ctx);
    expect(started.split("\n")[0]).toBe("Merging main into agent/san-2-totals: 2 conflicts to resolve.");
    expect(started).toContain("src/util.ts");
    expect(started).toContain("package-lock.json conflicted: took main's version");
    expect(await mergeWriteBlock(1)).toMatch(/a merge is in progress/);

    const read = await readConflict(ctx, { path: "src/app.ts", start_line: null, end_line: null });
    expect(read).toContain("<<<<<<< agent/san-2-totals (your branch)");
    expect(read).toContain("line 8 theirs");
    expect(await readConflict(ctx, { path: "src/old.ts", start_line: null, end_line: null })).toContain("main deleted it, your branch changed it");

    const withMarkers = read.split("\n").slice(2).map((l) => l.replace(/^\d+: /, "")).join("\n");
    expect(await resolveConflict(ctx, { path: "src/app.ts", content: withMarkers })).toMatch(/^Error: src\/app.ts still has conflict markers/);
    expect(await resolveConflict(ctx, { path: "src/app.ts", content: null })).toMatch(/^Error: both sides changed/);
    expect(await finishMerge(ctx, { outcome: "commit" })).toMatch(/^Error: 2 conflicts still unresolved/);
    const oursApp = lines(10).replace("line 3\n", "line 3 ours\n");
    expect(await resolveConflict(ctx, { path: "src/app.ts", content: oursApp })).toMatch(/^Resolved src\/app.ts: 1 conflict left\.\nNote: this is exactly your branch's version/);
    const resolvedApp = lines(10).replace("line 3\n", "line 3 ours and theirs\n").replace("line 8\n", "line 8 theirs\n");
    expect(await resolveConflict(ctx, { path: "src/app.ts", content: resolvedApp })).toBe("Resolved src/app.ts: 1 conflict left.");
    expect(await resolveConflict(ctx, { path: "src/old.ts", content: null })).toMatch(/^Resolved src\/old.ts \(deleted\): every conflict is resolved/);

    const done = await finishMerge(ctx, { outcome: "commit" });
    expect(done).toMatch(/^Merged main \(\w{7}\) into agent\/san-2-totals: commit \w{7}; resolved 2 conflicts \(src\/app.ts, src\/old.ts\); merged src\/util.ts automatically\./);
    expect(stored).toBeNull();

    const head = git(["rev-parse", "agent/san-2-totals"]).trim();
    expect(git(["rev-parse", `${head}^1`, `${head}^2`]).trim().split("\n")).toEqual([ours, theirs]);
    const show = (path: string) => git(["show", `${head}:${path}`]);
    expect(show("src/app.ts")).toBe(resolvedApp);
    expect(show("src/util.ts")).toBe(lines(12).replace("line 1\n", "line 1 ours\n").replace("line 12\n", "line 12 theirs\n"));
    expect(show("package-lock.json")).toContain('"theirs"');
    expect(show("src/feature.ts")).toContain("feature");
    expect(show("docs/main.md")).toBe("# main\n");
    expect(() => show("src/old.ts")).toThrow();
    expect(git(["ls-tree", head, "bin/run.sh"])).toMatch(/^100755 /);
    // GitHub's view afterwards: the pull request merges into main without conflicts, and main is in the branch.
    git(["merge-tree", "--write-tree", "main", "agent/san-2-totals"]);
    git(["merge-base", "--is-ancestor", "main", "agent/san-2-totals"]);
    expect(await mergeWriteBlock(1)).toBeNull();
  });

  it("drops a merge when the branch moves, recognizes a retried commit and aborts", async () => {
    git(["checkout", "-q", "main"]);
    git(["checkout", "-q", "-b", "agent/b"]);
    write({ "src/app.ts": lines(10).replace("line 5\n", "line 5 b\n") });
    commitAll("b ours");
    git(["checkout", "-q", "main"]);
    write({ "src/app.ts": lines(10).replace("line 5\n", "line 5 main2\n") });
    commitAll("main2");
    const ctx = { token: "t", repo: "o/r", defaultBranch: "main", branch: "agent/b", runId: 1, permissions: ["code.write"] as never, canAddDependency: true };

    expect((await mergeDefaultBranch(ctx)).split("\n")[0]).toBe("Merging main into agent/b: 1 conflict to resolve.");
    expect((await mergeDefaultBranch(ctx)).split("\n")[0]).toBe("A merge of main into agent/b is in progress: 1 conflict left of 1.");
    expect(await finishMerge(ctx, { outcome: "abort" })).toMatch(/^Aborted the merge of main into agent\/b/);
    expect(stored).toBeNull();

    await mergeDefaultBranch(ctx);
    await resolveConflict(ctx, { path: "src/app.ts", content: "resolved\n" });
    git(["checkout", "-q", "agent/b"]);
    write({ "other.txt": "x\n" });
    commitAll("moved");
    git(["checkout", "-q", "main"]);
    expect(await finishMerge(ctx, { outcome: "commit" })).toMatch(/^Error: agent\/b moved since the merge started/);
    expect(stored).toBeNull();

    await mergeDefaultBranch(ctx);
    await resolveConflict(ctx, { path: "src/app.ts", content: "resolved\n" });
    const before = JSON.parse(JSON.stringify(stored));
    expect(await finishMerge(ctx, { outcome: "commit" })).toMatch(/^Merged main/);
    // An Inngest retry of the same step: the commit is already there.
    stored = before;
    expect(await finishMerge(ctx, { outcome: "commit" })).toMatch(/^Merged main/);
    expect(stored).toBeNull();
    expect(git(["show", "agent/b:src/app.ts"])).toBe("resolved\n");
    expect(git(["show", "agent/b:other.txt"])).toBe("x\n");
  });
});
