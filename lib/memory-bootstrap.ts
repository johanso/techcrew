import type { RepoReader } from "@/lib/memory-loader";

/**
 * What a bootstrap reads from a repository's default branch (docs/brain-plan.md): a fixed list of files that describe how
 * work is done there (README, contributing and agent notes, package scripts, TypeScript, lint and formatter
 * configuration, CI workflows) plus the top-level tree and where the tests are. Nothing else is ever read, so no
 * environment file or source code goes to the model. Capped per file and in total. Pure apart from the reader.
 */

export type BootstrapReader = RepoReader & {
  /** Every file path of the repository at the same ref, with its size. */
  listFiles(): Promise<{ path: string; size: number }[]>;
};

/** One thing the model reads: a repository file, or a summary of the tree (its path says which). */
export type RepoFact = { path: string; content: string };

/** Characters sent to the model, all facts together. */
export const BOOTSTRAP_CHARS_MAX = 40_000;
/** A file larger than this is left unread. */
const FILE_BYTES_MAX = 200_000;
const WORKFLOWS_MAX = 4;
const TREE_CHARS = 3_000;
const TESTS_CHARS = 2_000;

export const TREE_FACT = "(top-level tree)";
export const TESTS_FACT = "(test files)";

// In the order the budget is spent. Each entry: the first of its names that exists, and its share.
const FIXED: { names: readonly string[]; max: number }[] = [
  { names: ["README.md", "readme.md", "Readme.md", "README", "README.rst"], max: 10_000 },
  { names: ["AGENTS.md"], max: 6_000 },
  { names: ["CLAUDE.md"], max: 4_000 },
  { names: ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"], max: 6_000 },
  { names: ["package.json"], max: 3_000 },
  { names: ["tsconfig.json"], max: 1_500 },
  {
    names: ["eslint.config.mjs", "eslint.config.js", "eslint.config.cjs", "eslint.config.ts", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc"],
    max: 2_500,
  },
  {
    names: [".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", "prettier.config.js", "prettier.config.mjs", "prettier.config.cjs", "prettier.config.ts"],
    max: 1_000,
  },
];
const WORKFLOW_CHARS = 2_500;

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const TEST_FILE = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb|exs)$/i;
const IGNORED = /(^|\/)(node_modules|vendor|dist|build|\.git)\//;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(0, max - 14))}\n… [truncated]` : text);

/** Only the scripts of a package.json (and its package manager): dependencies and settings say little. */
function packageScripts(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { scripts, packageManager, engines } = parsed as { scripts?: unknown; packageManager?: unknown; engines?: unknown };
    return JSON.stringify({ packageManager, engines, scripts: scripts ?? {} }, null, 2);
  } catch {
    return null;
  }
}

/** The files and folders at the root, folders with how many files they hold. */
export function topLevelTree(paths: readonly string[]) {
  const folders = new Map<string, number>();
  const files: string[] = [];
  for (const path of paths) {
    const slash = path.indexOf("/");
    if (slash === -1) files.push(path);
    else folders.set(path.slice(0, slash), (folders.get(path.slice(0, slash)) ?? 0) + 1);
  }
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [
    ...[...folders].sort(([a], [b]) => byName(a, b)).map(([name, count]) => `${name}/ (${count} file${count === 1 ? "" : "s"})`),
    ...files.sort(byName),
  ].join("\n");
}

/** Where the tests are: each folder that holds test files, how many, and one of them. Null without any. */
export function testLayout(paths: readonly string[]) {
  const folders = new Map<string, string[]>();
  for (const path of paths.filter((candidate) => TEST_FILE.test(candidate) && !IGNORED.test(candidate)).sort()) {
    const folder = path.slice(0, path.lastIndexOf("/") + 1) || "./";
    folders.set(folder, [...(folders.get(folder) ?? []), path]);
  }
  if (!folders.size) return null;
  return [...folders]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([folder, files]) => `${folder}: ${files.length} (e.g. ${files[0]})`)
    .join("\n");
}

/** The repository's facts, within BOOTSTRAP_CHARS_MAX. Empty for a repository without files. */
export async function readRepositoryFacts(reader: BootstrapReader): Promise<RepoFact[]> {
  const files = await reader.listFiles();
  const sizes = new Map(files.map((file) => [file.path, file.size]));
  const paths = [...sizes.keys()];
  const facts: RepoFact[] = [];
  let left = BOOTSTRAP_CHARS_MAX;
  const add = (path: string, content: string | null, max: number) => {
    const text = content?.trim();
    if (!text || left < 200) return;
    const clipped = clip(text, Math.min(max, left));
    left -= clipped.length;
    facts.push({ path, content: clipped });
  };

  // The layout first: small, and it must not be crowded out by long documents.
  if (paths.length) add(TREE_FACT, topLevelTree(paths), TREE_CHARS);
  add(TESTS_FACT, testLayout(paths), TESTS_CHARS);

  const wanted = [
    ...FIXED.flatMap(({ names, max }) => {
      const name = names.find((candidate) => sizes.has(candidate));
      return name ? [{ path: name, max }] : [];
    }),
    ...paths
      .filter((path) => WORKFLOW.test(path))
      .sort()
      .slice(0, WORKFLOWS_MAX)
      .map((path) => ({ path, max: WORKFLOW_CHARS })),
  ];
  for (const { path, max } of wanted) {
    if ((sizes.get(path) ?? 0) > FILE_BYTES_MAX || left < 200) continue;
    const content = await reader.readFile(path);
    add(path, path === "package.json" && content !== null ? packageScripts(content) : content, max);
  }
  return facts;
}
