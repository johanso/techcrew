import "server-only";

import type { FunctionTool } from "openai/resources/responses/responses";

import type { PermissionId } from "@/lib/agent-config";
import type { AgentStage } from "@/lib/agent-run-config";
import { readSkill, searchSkill, type AgentSkill } from "@/lib/agent-skills";
import { READ_REFERENCE_MAX_CHARS } from "@/lib/reference-config";
import { screenshotIdOf, screenshotImage, type ToolImage } from "@/lib/reference-images";
import { listReferencesForAgent, readReferenceForAgent, type AgentReference } from "@/lib/references";
import {
  GithubError,
  commitFiles,
  compareBranches,
  deleteRepoFile,
  getBranchSha,
  getCommitChecks,
  getRepoFile,
  listRepoFiles,
  listRootFiles,
  putRepoFile,
  searchRepoCode,
} from "@/lib/github";
import { addRepoDependency, runRepoCommand } from "@/lib/sandbox";
import { browsePreview } from "@/lib/sandbox/browser";
import { BROWSE_ACTIONS, BROWSE_COLOR_SCHEMES, BROWSE_STEPS_MAX, PREVIEW_STAGES, browseReport, parseBrowseArgs, type ScreenshotDelivery } from "@/lib/sandbox/browser-config";
import { addDependencyCommand, dependencyChange, dependencyPlan, dependencyReadFiles, dependencyReport, dependencySpec, parseDependencyArgs } from "@/lib/sandbox/dependency-config";
import { SANDBOX_COMMAND_MAX, SANDBOX_STAGES, parseSandboxCommand, sandboxReport, type SandboxCommands } from "@/lib/sandbox/config";
import { isStorageConfigured, uploadRunScreenshot } from "@/lib/storage";

/**
 * The tools an agent can call while it works a stage, backed by the GitHub API with the workspace owner's token.
 * What an agent gets depends on its stage and its granted permissions, so permissions are enforced, not just declared.
 * Agents with skills switched on also get search_skill and read_skill (read-only, any stage), and on a card with references
 * every agent gets list_references and read_reference (read-only; images come back as image input). With the workspace's sandbox on,
 * "Run tests in a sandbox" adds run_tests, run_build and run_command on the working branch (lib/sandbox), and with
 * previews on too, browse_preview for the Tester: a headless browser on the run's live preview (lib/sandbox/browser.ts).
 * "Manage dependencies" with the sandbox on gives the Developer add_dependency (npm resolves the package in the sandbox,
 * then one commit of package.json and the lockfile through the GitHub API).
 * Every result is a string for the model; recoverable errors are returned as text so the agent can adjust.
 */

export type ToolContext = {
  token: string;
  repo: string;
  defaultBranch: string;
  /** The run's working branch (null before the developer creates it). */
  branch: string | null;
  stage: AgentStage;
  permissions: PermissionId[];
  /** Skills switched on for the agent (lib/agent-skills.ts); search_skill and read_skill only reach these. */
  skills: AgentSkill[];
  /** The workspace's sandbox when it's switched on and the server has a host (Settings → Sandbox), else null. */
  sandbox: { runId: number; commands: SandboxCommands } | null;
  /**
   * The run's preview when the sandbox and previews are on (Settings → Sandbox), else null: browse_preview. `vision`:
   * the stage's model sees images, so each screenshot is also attached for it (as a placeholder, lib/reference-images.ts).
   */
  preview: { workspaceId: number; runId: number; vision: boolean } | null;
  /**
   * The card's references (lib/references.ts) and whether the stage's model can see images; null or empty: no
   * reference tools. read_reference returns an image only when `vision` is true.
   */
  references: { items: AgentReference[]; vision: boolean } | null;
};

const OUTPUT_MAX = 24_000;
const LIST_MAX = 400;
const READ_LINES_MAX = 500;
const WRITE_BYTES_MAX = 200_000;

// Files no agent may write: CI definitions (could exfiltrate secrets), env files (.env.example is fine), git internals.
const PROTECTED = [/^\.github\/workflows\//, /(^|\/)\.env(\.(?!example$)[^/]*)?$/, /(^|\/)\.git\//];
// Dependency manifests and lockfiles need the "Manage dependencies" permission.
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
  if (MANIFESTS.test(path) && !ctx.permissions.includes("deps.manage")) {
    return `Refused: ${path} is a dependency manifest and this agent doesn't have the "Manage dependencies" permission. Solve it without new dependencies, or explain in your result that a dependency is needed.`;
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
  search_skill: fn(
    "search_skill",
    "Search one of your skills (listed in your instructions) for the guide that fits. Returns file paths with titles and summaries.",
    {
      skill: { type: "string", description: "The skill's name, e.g. \"modern-web-guidance\"." },
      query: { type: "string", description: "2–5 words naming one capability or pattern, e.g. \"light dismiss dialog\"." },
    }
  ),
  run_tests: fn(
    "run_tests",
    "Run the repository's tests in a sandbox on the working branch's latest commit (dependencies are installed first). Returns passed or failed and the end of the output.",
    {}
  ),
  add_dependency: fn(
    "add_dependency",
    "Add an npm package to the repository: npm resolves it in a sandbox (with network, no install scripts) and package.json and the lockfile are committed to the working branch as one commit. The only way to add a package: never edit dependencies in package.json or the lockfile by hand.",
    {
      name: { type: "string", description: 'The npm package name, e.g. "@fontsource/inter" or "zod". No URLs, repositories or paths.' },
      version: {
        type: ["string", "null"],
        description: 'An exact version ("5.2.5"), one simple range ("^5.2.0", "~5.2", "5.x") or null for the latest release.',
      },
      dev: { type: "boolean", description: "true for devDependencies (tests, build tools, types); false for dependencies the app uses at runtime." },
    }
  ),
  run_build: fn("run_build", "Run the repository's build in a sandbox on the working branch's latest commit. Returns passed or failed and the end of the output.", {}),
  run_command: fn(
    "run_command",
    "Run one shell command at the repository root in a sandbox on the working branch's latest commit, after installing dependencies: e.g. a single test file, the type checker or the linter. No network; files it writes are thrown away.",
    { command: { type: "string", description: `One line, up to ${SANDBOX_COMMAND_MAX} characters, e.g. "npx vitest run src/split.test.ts".` } }
  ),
  browse_preview: {
    type: "function",
    name: "browse_preview",
    description:
      "Open this pull request's live preview in a headless browser, run the steps in order and get back the HTTP status, console errors, page errors, failed requests, how each step went and the page's accessibility outline. Every call is a fresh browser: nothing (sign-in, form input, the page you were on) carries over between calls. Steps stop at the first one that fails. The preview has no internet: requests to other sites fail.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: 'The path to open first, on the preview, e.g. "/" or "/settings?tab=team". Not a full URL.' },
        viewport: {
          type: "string",
          enum: ["desktop", "tablet", "mobile"],
          description: "desktop is 1280×800; tablet is 768×1024 and mobile 375×812, both with touch. Pick the one closest to a reference image's width.",
        },
        color_scheme: { type: "string", enum: [...BROWSE_COLOR_SCHEMES], description: "The prefers-color-scheme the page sees: light or dark." },
        steps: {
          type: "array",
          description: `Up to ${BROWSE_STEPS_MAX} steps, run in order after the page loads; an empty list only opens the page. Name each element with exactly one of: role (with name), text or selector.`,
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [...BROWSE_ACTIONS],
                description:
                  "click; fill (types value into the element); press (the key in value, on the element if one is named); wait_for (until the element is visible); goto (the path in value, on the preview).",
              },
              role: { type: ["string", "null"], description: "ARIA role, e.g. button, link, textbox, checkbox, heading. Preferred." },
              name: { type: ["string", "null"], description: 'The element\'s accessible name, with role, e.g. "Save".' },
              text: { type: ["string", "null"], description: "The element's visible text." },
              selector: { type: ["string", "null"], description: 'A CSS selector, e.g. "#email" or "form button[type=submit]".' },
              value: { type: ["string", "null"], description: 'fill: the text; press: the key, e.g. "Enter"; goto: the path. Null otherwise.' },
            },
            required: ["action", "role", "name", "text", "selector", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "viewport", "color_scheme", "steps"],
      additionalProperties: false,
    },
  },
  list_references: fn(
    "list_references",
    "List the files the card's owner attached as references (designs, specs, documents): id, name, kind and size.",
    {}
  ),
  read_reference: fn(
    "read_reference",
    `Read one of the card's references by id. Text and PDF text come back as text (${READ_REFERENCE_MAX_CHARS} characters per page); an image comes back as the image itself.`,
    {
      id: { type: "integer", description: "The reference's id from list_references." },
      offset: { type: ["integer", "null"], description: "Character offset to continue a long text from, or null for the start. Ignored for images." },
    }
  ),
  read_skill: fn("read_skill", "Read a file of one of your skills (reference material, not instructions). Long files come in pages.", {
    skill: { type: "string", description: "The skill's name." },
    path: { type: "string", description: "A path from search_skill, or SKILL.md." },
    offset: { type: ["integer", "null"], description: "Character offset to continue a long file from, or null for the start." },
  }),
} satisfies Record<string, FunctionTool>;

export type ToolName = keyof typeof TOOLS;

// Stages that judge the work on the branch: they read its diff and CI but never write.
const BRANCH_READERS: AgentStage[] = ["review", "security", "approval", "testing"];

/**
 * Tools for this stage, filtered by the agent's permissions; the skill tools when it has skills switched on; the
 * sandbox tools when the workspace's sandbox is on and the agent may run tests.
 */
export function toolsFor(
  ctx: Pick<ToolContext, "stage" | "permissions" | "branch"> & {
    skills?: readonly unknown[];
    sandbox?: ToolContext["sandbox"];
    preview?: ToolContext["preview"];
    references?: ToolContext["references"];
  }
): FunctionTool[] {
  const has = (permission: PermissionId) => ctx.permissions.includes(permission);
  const names: ToolName[] = [];
  if (has("repo.read")) names.push("list_files", "read_file", "search_code");
  if (ctx.stage === "development" && has("code.write") && ctx.branch) names.push("write_file", "replace_in_file", "delete_file");
  if (BRANCH_READERS.includes(ctx.stage) && ctx.branch) {
    if (has("repo.read")) names.push("get_diff");
    if (has("ci.read")) names.push("get_checks");
  }
  if (ctx.sandbox && ctx.branch && SANDBOX_STAGES.includes(ctx.stage) && has("tests.run")) {
    if (ctx.sandbox.commands.test) names.push("run_tests");
    if (ctx.sandbox.commands.build) names.push("run_build");
    names.push("run_command");
  }
  // It commits, so it goes where code is written; it runs no code (lockfile only, no scripts), so not tests.run.
  if (ctx.sandbox && ctx.branch && ctx.stage === "development" && has("code.write") && has("deps.manage")) names.push("add_dependency");
  if (ctx.preview && ctx.branch && PREVIEW_STAGES.includes(ctx.stage) && has("tests.run")) names.push("browse_preview");
  if (ctx.skills?.length) names.push("search_skill", "read_skill");
  if (ctx.references?.items.length) names.push("list_references", "read_reference");
  return names.map((name) => TOOLS[name]);
}

// ── Execution ──────────────────────────────────────────────────────────────────

const ref = (ctx: ToolContext) => ctx.branch ?? ctx.defaultBranch;

/**
 * What a tool returns: the text for the model, plus a screenshot's storage key for the agent log (browse_preview),
 * images for the model (read_reference, and browse_preview's screenshot for a model that sees) and the log target when
 * the arguments don't name it (a reference's name).
 */
type ToolOutput = { text: string; screenshotKey: string | null; images?: ToolImage[]; target?: string | null };

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string | ToolOutput> {
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
    case "run_tests":
    case "run_build":
    case "run_command": {
      if (!ctx.sandbox || !ctx.branch) return "Error: the sandbox isn't available.";
      const parsed = parseSandboxCommand(name === "run_tests" ? ctx.sandbox.commands.test : name === "run_build" ? ctx.sandbox.commands.build : args.command);
      if (!parsed.ok) return `Error: ${parsed.error}`;
      const command = parsed.command;
      if (!command) return "Error: there is no command to run.";
      // The latest commit, not the branch name: the report then matches exactly what the agent pushed.
      const sha = await getBranchSha(ctx.token, ctx.repo, ctx.branch);
      if (!sha) return `Error: branch ${ctx.branch} not found.`;
      const run = await runRepoCommand({ token: ctx.token, repo: ctx.repo, ref: sha, runId: ctx.sandbox.runId, install: ctx.sandbox.commands.install, command });
      return sandboxReport(run);
    }
    case "add_dependency":
      return addDependency(ctx, args);
    case "browse_preview": {
      if (!ctx.preview) return "Error: previews aren't available.";
      const parsed = parseBrowseArgs(args);
      if (!parsed.ok) return `Error: ${parsed.error}`;
      const browsed = await browsePreview(ctx.preview.runId, parsed.value);
      if (browsed.kind !== "done") return browseReport(parsed.value, browsed);
      const screenshotKey = await saveScreenshot(ctx.preview, browsed.screenshot);
      // The model sees the screenshot only as a placeholder of this run's own file; the agent log keeps the key.
      const shotId = screenshotKey && ctx.preview.vision ? screenshotIdOf(screenshotKey) : null;
      const delivery: ScreenshotDelivery = !screenshotKey ? "none" : shotId ? "attached" : ctx.preview.vision ? "saved" : "saved_no_vision";
      return {
        text: browseReport(parsed.value, { kind: "done", output: browsed.output, screenshot: delivery }),
        screenshotKey,
        images: shotId ? [screenshotImage(shotId)] : [],
      };
    }
    case "search_skill":
      return searchSkill(ctx.skills, args.skill, args.query);
    case "read_skill":
      return readSkill(ctx.skills, args.skill, args.path, args.offset);
    case "list_references":
      return listReferencesForAgent(ctx.references?.items ?? [], ctx.references?.vision ?? false, Boolean(ctx.preview && PREVIEW_STAGES.includes(ctx.stage)));
    case "read_reference": {
      const read = await readReferenceForAgent(ctx.references?.items ?? [], args.id, args.offset, ctx.references?.vision ?? false);
      return { text: read.text, screenshotKey: null, images: read.images, target: read.target };
    }
    default:
      return `Error: unknown tool ${name}.`;
  }
}

/**
 * add_dependency: validate, check the repository uses npm, install in the sandbox (lockfile only), then commit
 * package.json and the lockfile as one commit on top of the commit that was installed on. The log target is the spec.
 */
async function addDependency(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const parsed = parseDependencyArgs(args);
  if (!parsed.ok) return textOutput(`Error: ${parsed.error}`);
  const request = parsed.value;
  const result = (text: string): ToolOutput => ({ text, screenshotKey: null, target: `${dependencySpec(request)}${request.dev ? " (dev)" : ""}` });
  if (!ctx.sandbox || !ctx.branch) return result("Error: the sandbox isn't available.");

  const sha = await getBranchSha(ctx.token, ctx.repo, ctx.branch);
  if (!sha) return result(`Error: branch ${ctx.branch} not found.`);
  const plan = dependencyPlan(await listRootFiles(ctx.token, ctx.repo, sha));
  if (!plan.ok) return result(`Error: ${plan.error}`);

  const installed = await addRepoDependency({
    token: ctx.token,
    repo: ctx.repo,
    ref: sha,
    runId: ctx.sandbox.runId,
    command: addDependencyCommand(request),
    files: dependencyReadFiles(plan),
  });
  if (installed.failedStep || !installed.files) return result(sandboxReport(installed));
  const change = dependencyChange(request, plan, installed.files);
  if (!change.ok) return result(`Error: ${change.error}`);

  let commit: string | null;
  try {
    commit = await commitFiles(ctx.token, ctx.repo, {
      branch: ctx.branch,
      parentSha: sha,
      message: `Add ${request.name}@${change.version ?? change.range}${request.dev ? " (dev)" : ""}`,
      files: change.files,
    });
  } catch (error) {
    // The ref only fast-forwards: a commit landed while npm worked, so these files are stale.
    if (error instanceof GithubError && error.status === 422) return result(`Error: ${ctx.branch} moved while the package was being added. Call add_dependency again.`);
    throw error;
  }
  return result(dependencyReport({ request, change, branch: ctx.branch, commit }));
}

/** Stores a browse_preview screenshot for the agent log. Best effort: without storage, or on an error, the log has none. */
async function saveScreenshot(preview: NonNullable<ToolContext["preview"]>, png: Buffer | null) {
  if (!png || !isStorageConfigured()) return null;
  return uploadRunScreenshot(preview.workspaceId, preview.runId, png).catch((error) => {
    console.error("[storage] screenshot upload failed", error);
    return null;
  });
}

const textOutput = (text: string): ToolOutput => ({ text, screenshotKey: null });

/**
 * Runs one tool call. Tools outside this agent's set are refused (the model only sees its own, but arguments are
 * untrusted). A revoked GitHub token is rethrown: no point continuing the stage.
 */
async function executeTool(ctx: ToolContext, allowed: FunctionTool[], name: string, rawArgs: string): Promise<ToolOutput> {
  if (!allowed.some((tool) => tool.name === name)) return textOutput(`Error: tool ${name} is not available to this agent.`);
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return textOutput("Error: arguments were not valid JSON.");
  }
  try {
    const output = await run(ctx, name, args);
    return typeof output === "string" ? textOutput(output) : output;
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) throw error;
    if (error instanceof GithubError) return textOutput(`GitHub error (${error.status}): ${error.message}`);
    throw error;
  }
}

/**
 * Runs one tool call and returns its output for the model with its agent log step (toolStep, plus a screenshot key),
 * and the images to attach (a reference read, a browser screenshot): the provider loop sends them; the log never
 * holds them.
 */
export async function callTool(
  ctx: ToolContext,
  allowed: FunctionTool[],
  name: string,
  rawArgs: string
): Promise<{ output: string; step: ToolStep; images: ToolImage[] }> {
  const { text, screenshotKey, images, target } = await executeTool(ctx, allowed, name, rawArgs);
  let step = toolStep(name, rawArgs, text);
  if (target) step = { ...step, target };
  return { output: text, step: screenshotKey ? { ...step, screenshotKey } : step, images: images ?? [] };
}

/** One tool call, for the card's agent log. */
export type ToolStep = {
  tool: string;
  /** The path, prefix or query it was about, if any. */
  target: string | null;
  ok: boolean;
  /** The tool's confirmation or error, first line, clipped; null for reads (their output is the file itself). */
  summary: string | null;
  /** Storage key of the screenshot a browse_preview call took (agent_run_steps.screenshot_key). Never sent to a client. */
  screenshotKey?: string;
};

// Tools whose output is content (a file, a listing, a diff): logging it would copy the repo into the database.
const READ_TOOLS = new Set(["list_files", "read_file", "search_code", "get_diff", "search_skill", "read_skill", "list_references", "read_reference"]);
const SUMMARY_MAX = 200;

/**
 * Turns a tool call and its output into a log step. Outputs starting with "Error" or "GitHub error" are failures (run,
 * executeTool), and so are sandbox runs and browser calls that failed or timed out (sandboxReport, browseReport): the
 * log shows them red. browse_preview logs its path and the report's first line, which never holds page text.
 */
export function toolStep(tool: string, rawArgs: string, output: string): ToolStep {
  let target: string | null = null;
  try {
    const args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    const value = args.path ?? args.path_prefix ?? args.query ?? args.command;
    if (typeof value === "string" && value) target = value;
    // Skill tools: which skill, then the file or the query ("modern-web-guidance/guides/css/css.md").
    if (typeof args.skill === "string" && args.skill) {
      target = typeof args.path === "string" ? `${args.skill}/${args.path}` : typeof args.query === "string" ? `${args.skill}: ${args.query}` : args.skill;
    }
  } catch {
    // Unparseable arguments: executeTool already answered with an error.
  }
  const ok = !/^(Error|GitHub error|Failed|Timed out)/.test(output);
  const firstLine = output.split("\n", 1)[0]!.trim();
  const summary = ok && READ_TOOLS.has(tool) ? null : firstLine.slice(0, SUMMARY_MAX) || null;
  return { tool, target, ok, summary };
}
