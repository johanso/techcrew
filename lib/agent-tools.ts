import "server-only";

import type { FunctionTool } from "openai/resources/responses/responses";

import type { SkillId } from "@/lib/agent-config";
import type { RunStage } from "@/lib/agent-run-config";
import {
  GithubError,
  compareBranches,
  deleteRepoFile,
  getBranchSha,
  getCommitChecks,
  getRepoFile,
  listRepoFiles,
  putRepoFile,
  searchRepoCode,
} from "@/lib/github";

/**
 * The tools an agent can call while it works a stage, backed by the GitHub API with the workspace owner's token.
 * What an agent gets depends on its stage and its attached skills, so skills are enforced, not just declared.
 * Every result is a string for the model; recoverable errors are returned as text so the agent can adjust.
 */

export type ToolContext = {
  token: string;
  repo: string;
  defaultBranch: string;
  /** The run's working branch (null before the developer creates it). */
  branch: string | null;
  stage: RunStage;
  skills: SkillId[];
};

const OUTPUT_MAX = 24_000;
const LIST_MAX = 400;
const READ_LINES_MAX = 500;
const WRITE_BYTES_MAX = 200_000;

// Files no agent may write: CI definitions (could exfiltrate secrets), env files (.env.example is fine), git internals.
const PROTECTED = [/^\.github\/workflows\//, /(^|\/)\.env(\.(?!example$)[^/]*)?$/, /(^|\/)\.git\//];
// Dependency manifests and lockfiles need the "Manage dependencies" skill.
const MANIFESTS =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?)$/;

const clip = (text: string, max = OUTPUT_MAX) => (text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text);

function cleanPath(path: unknown) {
  if (typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\.\//, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.split("/").some((part) => part === ".." || part === "")) return null;
  return trimmed;
}

function writeRefusal(ctx: ToolContext, path: string) {
  if (PROTECTED.some((pattern) => pattern.test(path))) return `Refused: ${path} is protected (CI workflows, env files and git internals can't be changed by agents).`;
  if (MANIFESTS.test(path) && !ctx.skills.includes("deps.manage")) {
    return `Refused: ${path} is a dependency manifest and this agent doesn't have the "Manage dependencies" skill. Solve it without new dependencies, or explain in your result that a dependency is needed.`;
  }
  return null;
}

// ── Definitions ────────────────────────────────────────────────────────────────

const fn = (name: string, description: string, properties: Record<string, unknown>): FunctionTool => ({
  type: "function",
  name,
  description,
  strict: true,
  parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

const commitMessage = { type: "string", description: "Short imperative commit message, e.g. \"Validate email on sign-up\"." };

const TOOLS = {
  list_files: fn("list_files", "List file paths in the repository (on the working branch when there is one). Use a prefix to narrow large repos.", {
    path_prefix: { type: "string", description: "Directory or path prefix, e.g. \"src/components/\". Empty string for the whole repository." },
  }),
  read_file: fn("read_file", `Read a text file with line numbers (up to ${READ_LINES_MAX} lines per call).`, {
    path: { type: "string" },
    start_line: { type: ["integer", "null"], description: "1-based first line, or null for the start." },
    end_line: { type: ["integer", "null"], description: "1-based last line, or null." },
  }),
  search_code: fn("search_code", "Search the repository's code on the default branch (GitHub code search syntax). Returns matching file paths.", {
    query: { type: "string" },
  }),
  write_file: fn("write_file", "Create or fully replace a file on the working branch (one commit). Prefer replace_in_file for small edits to existing files.", {
    path: { type: "string" },
    content: { type: "string", description: "The complete new file content." },
    commit_message: commitMessage,
  }),
  replace_in_file: fn("replace_in_file", "Replace one exact snippet in a file on the working branch (one commit). old_text must appear exactly once.", {
    path: { type: "string" },
    old_text: { type: "string" },
    new_text: { type: "string" },
    commit_message: commitMessage,
  }),
  delete_file: fn("delete_file", "Delete a file on the working branch (one commit).", { path: { type: "string" }, commit_message: commitMessage }),
  get_diff: fn("get_diff", "The working branch's changes against the default branch: changed files with their patches.", {}),
  get_checks: fn("get_checks", "CI checks (GitHub Actions, deploy previews …) on the working branch's latest commit.", {}),
} satisfies Record<string, FunctionTool>;

export type ToolName = keyof typeof TOOLS;

/** Tools for this stage, filtered by the agent's skills. */
export function toolsFor(ctx: Pick<ToolContext, "stage" | "skills" | "branch">): FunctionTool[] {
  const has = (skill: SkillId) => ctx.skills.includes(skill);
  const names: ToolName[] = [];
  if (has("repo.read")) names.push("list_files", "read_file", "search_code");
  if (ctx.stage === "development" && has("code.write") && ctx.branch) names.push("write_file", "replace_in_file", "delete_file");
  if ((ctx.stage === "review" || ctx.stage === "testing") && ctx.branch) {
    if (has("repo.read")) names.push("get_diff");
    if (has("ci.read")) names.push("get_checks");
  }
  return names.map((name) => TOOLS[name]);
}

// ── Execution ──────────────────────────────────────────────────────────────────

const ref = (ctx: ToolContext) => ctx.branch ?? ctx.defaultBranch;

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name as ToolName) {
    case "list_files": {
      const prefix = typeof args.path_prefix === "string" ? args.path_prefix.replace(/^\.?\//, "") : "";
      const { files, truncated } = await listRepoFiles(ctx.token, ctx.repo, ref(ctx));
      const matches = files.filter((f) => f.path.startsWith(prefix));
      const shown = matches.slice(0, LIST_MAX).map((f) => `${f.path} (${f.size} B)`);
      const more = matches.length > LIST_MAX ? `\n… ${matches.length - LIST_MAX} more. Use a longer prefix.` : "";
      return `${matches.length} files${truncated ? " (repository tree truncated by GitHub)" : ""}:\n${shown.join("\n")}${more}`;
    }
    case "read_file": {
      const path = cleanPath(args.path);
      if (!path) return "Error: invalid path.";
      const file = await getRepoFile(ctx.token, ctx.repo, path, ref(ctx));
      if (!file) return `Error: ${path} not found on ${ref(ctx)}.`;
      const lines = file.content.split("\n");
      const start = Math.max(1, typeof args.start_line === "number" ? args.start_line : 1);
      const end = Math.min(lines.length, typeof args.end_line === "number" ? args.end_line : start + READ_LINES_MAX - 1, start + READ_LINES_MAX - 1);
      const body = lines
        .slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join("\n");
      return clip(`${path} (lines ${start}-${end} of ${lines.length})\n${body}`);
    }
    case "search_code": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return "Error: empty query.";
      const result = await searchRepoCode(ctx.token, ctx.repo, query);
      return result.paths.length ? `${result.total} matches:\n${result.paths.join("\n")}` : "No matches.";
    }
    case "write_file": {
      const path = cleanPath(args.path);
      if (!path || !ctx.branch) return "Error: invalid path.";
      const refusal = writeRefusal(ctx, path);
      if (refusal) return refusal;
      const content = typeof args.content === "string" ? args.content : "";
      if (Buffer.byteLength(content) > WRITE_BYTES_MAX) return "Error: file too large for one write.";
      const existing = await getRepoFile(ctx.token, ctx.repo, path, ctx.branch);
      const message = typeof args.commit_message === "string" && args.commit_message.trim() ? args.commit_message.trim() : `Update ${path}`;
      await putRepoFile(ctx.token, ctx.repo, { path, content, message, branch: ctx.branch, sha: existing?.sha });
      return `${existing ? "Updated" : "Created"} ${path} on ${ctx.branch}.`;
    }
    case "replace_in_file": {
      const path = cleanPath(args.path);
      if (!path || !ctx.branch) return "Error: invalid path.";
      const refusal = writeRefusal(ctx, path);
      if (refusal) return refusal;
      const oldText = typeof args.old_text === "string" ? args.old_text : "";
      const newText = typeof args.new_text === "string" ? args.new_text : "";
      if (!oldText) return "Error: old_text is empty. Use write_file to create files.";
      const file = await getRepoFile(ctx.token, ctx.repo, path, ctx.branch);
      if (!file) return `Error: ${path} not found on ${ctx.branch}. Use write_file to create it.`;
      const count = file.content.split(oldText).length - 1;
      if (count !== 1) return `Error: old_text appears ${count} times in ${path}; it must appear exactly once. Include more surrounding lines.`;
      const message = typeof args.commit_message === "string" && args.commit_message.trim() ? args.commit_message.trim() : `Update ${path}`;
      await putRepoFile(ctx.token, ctx.repo, { path, content: file.content.replace(oldText, () => newText), message, branch: ctx.branch, sha: file.sha });
      return `Edited ${path} on ${ctx.branch}.`;
    }
    case "delete_file": {
      const path = cleanPath(args.path);
      if (!path || !ctx.branch) return "Error: invalid path.";
      const refusal = writeRefusal(ctx, path);
      if (refusal) return refusal;
      const file = await getRepoFile(ctx.token, ctx.repo, path, ctx.branch);
      if (!file) return `Error: ${path} not found on ${ctx.branch}.`;
      const message = typeof args.commit_message === "string" && args.commit_message.trim() ? args.commit_message.trim() : `Delete ${path}`;
      await deleteRepoFile(ctx.token, ctx.repo, { path, message, branch: ctx.branch, sha: file.sha });
      return `Deleted ${path} on ${ctx.branch}.`;
    }
    case "get_diff": {
      if (!ctx.branch) return "Error: there is no working branch yet.";
      const diff = await compareBranches(ctx.token, ctx.repo, ctx.defaultBranch, ctx.branch);
      if (!diff.files.length) return `${ctx.branch} has no changes against ${ctx.defaultBranch}.`;
      const header = `${ctx.branch} is ${diff.aheadBy} commit(s) ahead and ${diff.behindBy} behind ${ctx.defaultBranch}. ${diff.files.length} file(s) changed.`;
      const files = diff.files.map((f) => `### ${f.path} (${f.status}, +${f.additions} −${f.deletions})\n${f.patch ?? "(binary or too large to show)"}`);
      return clip(`${header}\n\n${files.join("\n\n")}`, 60_000);
    }
    case "get_checks": {
      if (!ctx.branch) return "Error: there is no working branch yet.";
      const sha = await getBranchSha(ctx.token, ctx.repo, ctx.branch);
      if (!sha) return `Error: branch ${ctx.branch} not found.`;
      const summary = await getCommitChecks(ctx.token, ctx.repo, sha);
      if (!summary.checks.length) return "No CI checks are configured for this commit.";
      return `Overall: ${summary.state}\n${summary.checks.map((c) => `- ${c.name}: ${c.status}${c.conclusion ? ` (${c.conclusion})` : ""}`).join("\n")}`;
    }
    default:
      return `Error: unknown tool ${name}.`;
  }
}

/**
 * Runs one tool call. Tools outside this agent's set are refused (the model only sees its own, but arguments are
 * untrusted). A revoked GitHub token is rethrown: no point continuing the stage.
 */
export async function executeTool(ctx: ToolContext, allowed: FunctionTool[], name: string, rawArgs: string): Promise<string> {
  if (!allowed.some((tool) => tool.name === name)) return `Error: tool ${name} is not available to this agent.`;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return "Error: arguments were not valid JSON.";
  }
  try {
    return await run(ctx, name, args);
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) throw error;
    if (error instanceof GithubError) return `GitHub error (${error.status}): ${error.message}`;
    throw error;
  }
}

/** One tool call, for the card's agent log. */
export type ToolStep = {
  tool: string;
  /** The path, prefix or query it was about, if any. */
  target: string | null;
  ok: boolean;
  /** The tool's confirmation or error, first line, clipped; null for reads (their output is the file itself). */
  summary: string | null;
};

// Tools whose output is content (a file, a listing, a diff): logging it would copy the repo into the database.
const READ_TOOLS = new Set(["list_files", "read_file", "search_code", "get_diff"]);
const SUMMARY_MAX = 200;

/** Turns a tool call and its output into a log step. Outputs starting with "Error" or "GitHub error" are failures (run, executeTool). */
export function toolStep(tool: string, rawArgs: string, output: string): ToolStep {
  let target: string | null = null;
  try {
    const args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    const value = args.path ?? args.path_prefix ?? args.query;
    if (typeof value === "string" && value) target = value;
  } catch {
    // Unparseable arguments: executeTool already answered with an error.
  }
  const ok = !/^(Error|GitHub error)/.test(output);
  const firstLine = output.split("\n", 1)[0]!.trim();
  const summary = ok && READ_TOOLS.has(tool) ? null : firstLine.slice(0, SUMMARY_MAX) || null;
  return { tool, target, ok, summary };
}
