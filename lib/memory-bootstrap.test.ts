import { describe, expect, it } from "vitest";

import { BOOTSTRAP_CHARS_MAX, TESTS_FACT, TREE_FACT, readRepositoryFacts, testLayout, topLevelTree, type BootstrapReader } from "@/lib/memory-bootstrap";

function reader(files: Record<string, string>) {
  const read: string[] = [];
  const bootstrap: BootstrapReader = {
    listDir: async () => null,
    listFiles: async () => Object.entries(files).map(([path, content]) => ({ path, size: content.length })),
    readFile: async (path) => {
      read.push(path);
      return files[path] ?? null;
    },
  };
  return { bootstrap, read };
}

describe("reading a repository for a first memory", () => {
  it("reads only the fixed list: never an environment file or source code", async () => {
    const { bootstrap, read } = reader({
      "README.md": "# App",
      ".env": "API_KEY=secret",
      ".env.local": "TOKEN=secret",
      "src/index.ts": "export const secret = 1;",
      "src/index.test.ts": "test",
      "package.json": JSON.stringify({ name: "app", scripts: { test: "vitest run" }, dependencies: { react: "19" } }),
      "tsconfig.json": "{}",
      ".eslintrc.json": "{}",
      ".prettierrc": "{}",
      ".github/workflows/ci.yml": "on: push",
      ".github/workflows/notes.md": "no",
      "docs/CONTRIBUTING.md": "Be kind.",
      "AGENTS.md": "Use pnpm.",
    });
    const facts = await readRepositoryFacts(bootstrap);
    expect(read.sort()).toEqual(
      [".eslintrc.json", ".github/workflows/ci.yml", ".prettierrc", "AGENTS.md", "README.md", "docs/CONTRIBUTING.md", "package.json", "tsconfig.json"].sort()
    );
    expect(facts.slice(0, 2).map((fact) => fact.path)).toEqual([TREE_FACT, TESTS_FACT]);
    const pkg = facts.find((fact) => fact.path === "package.json")!.content;
    expect(pkg).toContain("vitest run");
    expect(pkg).not.toContain("react");
    expect(JSON.stringify(facts)).not.toContain("secret");
  });

  it("stays within the total budget and skips huge files", async () => {
    const { bootstrap, read } = reader({
      "README.md": "r".repeat(100_000),
      "AGENTS.md": "a".repeat(300_000),
      "CLAUDE.md": "c".repeat(50_000),
      "CONTRIBUTING.md": "d".repeat(50_000),
      "tsconfig.json": "t".repeat(50_000),
      "eslint.config.mjs": "e".repeat(50_000),
      ".github/workflows/a.yml": "w".repeat(50_000),
      ".github/workflows/b.yml": "w".repeat(50_000),
      ".github/workflows/c.yml": "w".repeat(50_000),
      ".github/workflows/d.yml": "w".repeat(50_000),
      ".github/workflows/e.yml": "w".repeat(50_000),
    });
    const facts = await readRepositoryFacts(bootstrap);
    expect(facts.reduce((sum, fact) => sum + fact.content.length, 0)).toBeLessThanOrEqual(BOOTSTRAP_CHARS_MAX);
    expect(read).not.toContain("AGENTS.md");
    expect(read).not.toContain(".github/workflows/e.yml");
    expect(facts.find((fact) => fact.path === "README.md")!.content).toContain("[truncated]");
  });

  it("copes with an empty repository and a broken package.json", async () => {
    await expect(readRepositoryFacts(reader({}).bootstrap)).resolves.toEqual([]);
    const facts = await readRepositoryFacts(reader({ "package.json": "{ nope" }).bootstrap);
    expect(facts.map((fact) => fact.path)).toEqual([TREE_FACT]);
  });

  it("summarizes the tree and the tests", () => {
    const paths = ["b.txt", "src/a.ts", "src/b.test.ts", "src/c.test.ts", "tests/e2e.py", "node_modules/x/y.test.js"];
    expect(topLevelTree(paths)).toBe("node_modules/ (1 file)\nsrc/ (3 files)\ntests/ (1 file)\nb.txt");
    expect(testLayout(paths)).toBe("src/: 2 (e.g. src/b.test.ts)\ntests/: 1 (e.g. tests/e2e.py)");
    expect(testLayout(["src/a.ts"])).toBeNull();
  });
});
