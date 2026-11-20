/**
 * add_dependency: the Developer adds an npm package. Pure and tested; lib/sandbox/docker.ts runs the install and
 * lib/agent-tools.ts commits what comes back.
 *
 * The install runs in the sandbox's prepare container (network on), as `npm install --package-lock-only
 * --ignore-scripts`: npm resolves the package and rewrites package.json and the lockfile without downloading
 * tarballs or running any script, so nothing from the package executes. The app reads both files back and commits
 * them to the branch through the GitHub API; the token never enters a container.
 */

/** package.json and a lockfile come back from the sandbox only up to this size each. */
export const DEPENDENCY_FILE_MAX_BYTES = 20 * 1024 * 1024;

const NAME_MAX = 214;
const VERSION_MAX = 64;

/** What the agent asked for. `version` null means npm's `latest`. */
export type DependencyRequest = { name: string; version: string | null; dev: boolean };

// npm's rules (validate-npm-package-name), a little stricter: lowercase, URL-safe, optional scope, and the first
// character a letter or digit so a name can never read as a command-line flag.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
// An exact version (1.2.3, 1.2.3-beta.1) or one simple range: ^1.2.3, ~1.2, 1.x, >=1.2.0, 2. No URLs, git, file:,
// link:, npm: aliases, tags or compound ranges. None of these characters is a quote, so the spec is safe in '…'.
const VERSION = /^(?:\^|~|>=|<=|>|<|=)?(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isPackageName(name: string) {
  return name.length <= NAME_MAX && PACKAGE_NAME.test(name);
}

export function isVersionSpec(version: string) {
  return version.length <= VERSION_MAX && VERSION.test(version);
}

/** The tool's arguments, validated. `version` "latest", empty or null all mean the latest release. */
export function parseDependencyArgs(args: Record<string, unknown>): { ok: true; value: DependencyRequest } | { ok: false; error: string } {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { ok: false, error: "name is required, e.g. \"@fontsource/inter\"." };
  if (/^@?[^@]+@/.test(name) && !isPackageName(name)) return { ok: false, error: "Give the version in version, not in name." };
  if (!isPackageName(name)) {
    return {
      ok: false,
      error: `"${name.slice(0, 80)}" isn't an npm package name: lowercase letters, digits, - . _ ~, optionally scoped (@scope/name). URLs, git repositories and paths aren't allowed.`,
    };
  }
  const rawVersion = typeof args.version === "string" ? args.version.trim() : "";
  const version = rawVersion === "" || rawVersion === "latest" ? null : rawVersion;
  if (version !== null && !isVersionSpec(version)) {
    return {
      ok: false,
      error:
        "version must be an exact version (5.2.5), one simple range (^5.2.0, ~5.2, 5.x, >=5.0.0) or \"latest\". URLs, git, file:, link:, aliases and other tags aren't allowed.",
    };
  }
  if (args.dev !== undefined && args.dev !== null && typeof args.dev !== "boolean") return { ok: false, error: "dev must be true or false." };
  return { ok: true, value: { name, version, dev: args.dev === true } };
}

/** `@fontsource/inter@latest`, `vitest@^3.2.0`. */
export const dependencySpec = (request: DependencyRequest) => `${request.name}@${request.version ?? "latest"}`;

/**
 * The install, run at the repository root in the sandbox. Lockfile only (no node_modules, no tarballs), no scripts.
 * The repository's .npmrc still applies (save-exact, legacy-peer-deps …): its maintainers' conventions.
 */
export function addDependencyCommand(request: DependencyRequest) {
  return `npm install --package-lock-only --ignore-scripts --no-audit --no-fund ${request.dev ? "--save-dev" : "--save-prod"} '${dependencySpec(request)}'`;
}

/** Which files the install rewrites and the app commits: package.json plus the npm lockfile, when the repository has one. */
export type DependencyPlan = { ok: true; lockfile: "package-lock.json" | "npm-shrinkwrap.json" | null } | { ok: false; error: string };

const OTHER_MANAGERS: [file: string, manager: string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "Yarn"],
  ["bun.lock", "Bun"],
  ["bun.lockb", "Bun"],
];

/**
 * From the names of the files at the repository root. npm only: a pnpm, Yarn or Bun lockfile would go stale, so those
 * repositories are refused with a message the agent can pass on.
 */
export function dependencyPlan(rootFiles: readonly string[]): DependencyPlan {
  const files = new Set(rootFiles);
  if (!files.has("package.json")) return { ok: false, error: "the repository has no package.json at its root, so there is nothing to add a package to." };
  const other = OTHER_MANAGERS.find(([file]) => files.has(file));
  if (other) {
    return {
      ok: false,
      error: `this repository uses ${other[1]} (${other[0]}) and add_dependency supports npm only. Don't edit the manifest or the lockfile by hand: say in your result which package is needed and why.`,
    };
  }
  return { ok: true, lockfile: files.has("npm-shrinkwrap.json") ? "npm-shrinkwrap.json" : files.has("package-lock.json") ? "package-lock.json" : null };
}

/** The files the sandbox reads back: package.json and the lockfile npm wrote (always, for the resolved version). */
export const dependencyReadFiles = (plan: Extract<DependencyPlan, { ok: true }>) => ["package.json", plan.lockfile ?? "package-lock.json"];

const recordOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return recordOf(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The version a lockfile pins for a top-level package: `packages["node_modules/<name>"]` (v2, v3), else `dependencies` (v1). */
export function resolvedVersion(lockfile: string, name: string): string | null {
  const lock = parseJson(lockfile);
  if (!lock) return null;
  const version = recordOf(recordOf(lock.packages)[`node_modules/${name}`]).version ?? recordOf(recordOf(lock.dependencies)[name]).version;
  return typeof version === "string" ? version : null;
}

/** The range package.json declares for `name` in dependencies (or devDependencies with `dev`). */
export function declaredRange(packageJson: string, name: string, dev: boolean): string | null {
  const manifest = parseJson(packageJson);
  const range = manifest ? recordOf(manifest[dev ? "devDependencies" : "dependencies"])[name] : undefined;
  return typeof range === "string" ? range : null;
}

export type DependencyChange =
  | { ok: true; version: string | null; range: string; files: { path: string; content: string }[] }
  | { ok: false; error: string };

/**
 * What to commit, from the files the sandbox read back (null: missing or too large): package.json must declare the
 * package in the right section, and the lockfile (when the repository has one) must pin it.
 */
export function dependencyChange(request: DependencyRequest, plan: Extract<DependencyPlan, { ok: true }>, files: Record<string, string | null>): DependencyChange {
  const manifest = files["package.json"];
  if (manifest == null) return { ok: false, error: "npm finished but package.json couldn't be read back (missing or larger than allowed)." };
  const range = declaredRange(manifest, request.name, request.dev);
  if (!range) return { ok: false, error: `npm finished but ${request.name} isn't in package.json's ${request.dev ? "devDependencies" : "dependencies"}.` };
  const lockText = files[plan.lockfile ?? "package-lock.json"] ?? null;
  const version = lockText === null ? null : resolvedVersion(lockText, request.name);
  if (plan.lockfile) {
    if (lockText === null) return { ok: false, error: `npm finished but ${plan.lockfile} couldn't be read back (missing or larger than allowed).` };
    if (!version) return { ok: false, error: `npm finished but ${plan.lockfile} doesn't pin ${request.name}.` };
  }
  const commit = [{ path: "package.json", content: manifest }];
  if (plan.lockfile && lockText !== null) commit.push({ path: plan.lockfile, content: lockText });
  return { ok: true, version, range, files: commit };
}

/**
 * The agent's confirmation. The first line is all the agent log keeps (toolStep): our own words, the package and
 * the files, never npm's output.
 */
export function dependencyReport(input: { request: DependencyRequest; change: Extract<DependencyChange, { ok: true }>; branch: string; commit: string | null }) {
  const { request, change } = input;
  const section = request.dev ? "devDependencies" : "dependencies";
  const label = `${request.name}@${change.version ?? change.range}`;
  const paths = change.files.map((file) => file.path).join(" and ");
  if (!input.commit) return `${label} is already in ${section} ("${change.range}"); nothing changed, so nothing was committed.`;
  return `Added ${label} to ${section} ("${change.range}"): committed ${paths} to ${input.branch} (${input.commit.slice(0, 7)}).
Import it where the code uses it. run_tests, run_build and run_command install it before they run.`;
}
