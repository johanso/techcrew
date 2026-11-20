import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, githubConnections } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * GitHub OAuth App integration used to link a repository to a workspace.
 * Callback URL to register on the OAuth App: `${NEXT_PUBLIC_APP_URL}/api/github/callback`.
 */

const API = "https://api.github.com";
/** `repo` lets agents read and push to private repositories; `read:user` identifies the account. */
const SCOPES = "repo read:user";
/** Holds state + PKCE verifier + return path during the OAuth round trip. */
export const GITHUB_OAUTH_COOKIE = "github_oauth";

export type GithubRepo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  url: string;
  defaultBranch: string;
  pushedAt: string | null;
};

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GithubError";
  }
}

export function isGithubConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function githubCallbackUrl(origin: string) {
  return `${origin}/api/github/callback`;
}

/** Fresh `state` and PKCE pair for one authorization attempt. */
export function createOAuthChallenge() {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function githubAuthorizeUrl(input: { state: string; challenge: string; redirectUri: string }) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: input.redirectUri,
    scope: SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return url.toString();
}

export async function exchangeCodeForToken(input: { code: string; verifier: string; redirectUri: string }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
  });
  // GitHub answers 200 with an `error` field when the exchange fails.
  const data = (await res.json().catch(() => null)) as { access_token?: string; scope?: string; error_description?: string } | null;
  if (!res.ok || !data?.access_token) {
    throw new GithubError(data?.error_description ?? "GitHub did not return an access token.", res.status);
  }
  return { accessToken: data.access_token, scope: data.scope ?? null };
}

async function githubRequest<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GithubError(data?.message ?? "GitHub request failed", res.status);
  return data as T;
}

type ApiRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  pushed_at: string | null;
  archived: boolean;
  permissions?: { push?: boolean };
};

function toRepo(repo: ApiRepo): GithubRepo {
  return {
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    description: repo.description,
    private: repo.private,
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
  };
}

/** Agents need to push branches, so only writable, non-archived repositories qualify. */
function isLinkable(repo: ApiRepo) {
  return !repo.archived && repo.permissions?.push === true;
}

export function getGithubUser(token: string) {
  return githubRequest<{ id: number; login: string; avatar_url: string | null }>(token, "/user");
}

/** Linkable repositories, most recently pushed first (up to 300). */
export async function listLinkableRepos(token: string) {
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await githubRequest<ApiRepo[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
    );
    repos.push(...batch.filter(isLinkable).map(toRepo));
    if (batch.length < 100) break;
  }
  return repos;
}

/** Re-reads a repository so links are always validated against live permissions. */
export async function getLinkableRepo(token: string, fullName: string) {
  const repo = await githubRequest<ApiRepo>(token, `/repos/${fullName}`);
  return isLinkable(repo) ? toRepo(repo) : null;
}

export type RepoContext = {
  description: string | null;
  topics: string[];
  /** Languages by share of bytes, largest first, e.g. ["TypeScript 82%", "CSS 11%"]. */
  languages: string[];
  /** Start of the README (plain text), or null when there is none. */
  readme: string | null;
};

/** What an AI needs to tailor an agent to a repository: description, topics, languages and the README's opening. */
export async function getRepoContext(token: string, fullName: string, readmeChars = 4000): Promise<RepoContext> {
  const [repo, languages, readme] = await Promise.all([
    githubRequest<{ description: string | null; topics?: string[] }>(token, `/repos/${fullName}`),
    githubRequest<Record<string, number>>(token, `/repos/${fullName}/languages`).catch(() => ({})),
    githubRequest<{ content?: string; encoding?: string }>(token, `/repos/${fullName}/readme`).catch(() => null),
  ]);
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  return {
    description: repo.description,
    topics: repo.topics ?? [],
    languages: Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, bytes]) => `${name} ${Math.round((bytes / total) * 100)}%`),
    readme:
      readme?.content && readme.encoding === "base64"
        ? Buffer.from(readme.content, "base64").toString("utf8").slice(0, readmeChars)
        : null,
  };
}

// ── Issues ─────────────────────────────────────────────────────────────────────

export type GithubIssue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
};

type ApiIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: (string | { name?: string })[];
  created_at: string;
  updated_at: string;
  // Present when the "issue" is actually a pull request.
  pull_request?: unknown;
};

/** Upper bound per sync, so one huge repo can't stall the board (5 pages × 100). */
const ISSUE_PAGES_MAX = 5;

/**
 * Issues of a repository, most recently updated first, without pull requests.
 * With `since`, returns every issue (open or closed) updated after it — enough to apply
 * edits, closes and reopens incrementally. Without it, only open issues (a first sync).
 */
export async function listRepoIssues(token: string, fullName: string, since: Date | null) {
  const issues: GithubIssue[] = [];
  for (let page = 1; page <= ISSUE_PAGES_MAX; page++) {
    const params = new URLSearchParams({
      state: since ? "all" : "open",
      sort: "updated",
      direction: "desc",
      per_page: "100",
      page: String(page),
    });
    if (since) params.set("since", since.toISOString());
    const batch = await githubRequest<ApiIssue[]>(token, `/repos/${fullName}/issues?${params}`);
    for (const issue of batch) {
      if (issue.pull_request) continue;
      issues.push({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        url: issue.html_url,
        labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name ?? "")).filter(Boolean),
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
      });
    }
    if (batch.length < 100) break;
  }
  return issues;
}

// ── Branches and files (used by the agent pipeline) ─────────────────────────────

/** Encodes each path segment but keeps the slashes, for /contents/{path} and ref URLs. */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Head commit sha of a branch, or null if the branch doesn't exist. */
export async function getBranchSha(token: string, fullName: string, branch: string) {
  try {
    const ref = await githubRequest<{ object: { sha: string } }>(token, `/repos/${fullName}/git/ref/heads/${encodePath(branch)}`);
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

export async function createBranch(token: string, fullName: string, branch: string, fromSha: string) {
  await githubRequest(token, `/repos/${fullName}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: fromSha } });
}

/** Every file path at `ref` (recursive tree). `truncated` is true for very large repositories. */
export async function listRepoFiles(token: string, fullName: string, ref: string) {
  const tree = await githubRequest<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    token,
    `/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  return {
    files: tree.tree.filter((entry) => entry.type === "blob").map((entry) => ({ path: entry.path, size: entry.size ?? 0 })),
    truncated: tree.truncated,
  };
}

/** Names of the files at the repository root at `ref` (one request, unlike the recursive tree). */
export async function listRootFiles(token: string, fullName: string, ref: string) {
  const entries = await githubRequest<{ name: string; type: string }[]>(token, `/repos/${fullName}/contents?ref=${encodeURIComponent(ref)}`);
  return entries.filter((entry) => entry.type === "file").map((entry) => entry.name);
}

/**
 * The repository at `ref` as a gzipped tarball stream (one top-level folder), or null when the ref doesn't exist.
 * GitHub answers with a redirect to a short-lived download URL; following it by hand keeps the token off that host.
 */
export async function getRepoTarball(token: string, fullName: string, ref: string): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(`${API}/repos/${fullName}/tarball/${encodeURIComponent(ref)}`, {
    headers: { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
    redirect: "manual",
    cache: "no-store",
  });
  if (res.status === 401) throw new GithubError("GitHub rejected the token.", 401);
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) return null;
  const archive = await fetch(location, { cache: "no-store" });
  return archive.ok ? archive.body : null;
}

/** A text file at `ref`, or null if it doesn't exist. `sha` is the blob sha, needed to update or delete it. */
export async function getRepoFile(token: string, fullName: string, path: string, ref: string) {
  try {
    const file = await githubRequest<{ type: string; content?: string; encoding?: string; sha: string; size: number }>(
      token,
      `/repos/${fullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`
    );
    if (file.type !== "file") return null;
    const content = file.content && file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : "";
    return { content, sha: file.sha, size: file.size };
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

/** Creates or replaces a file on `branch` with one commit. */
export async function putRepoFile(
  token: string,
  fullName: string,
  input: { path: string; content: string; message: string; branch: string; sha?: string }
) {
  const result = await githubRequest<{ commit: { sha: string } }>(token, `/repos/${fullName}/contents/${encodePath(input.path)}`, {
    method: "PUT",
    body: {
      message: input.message,
      content: Buffer.from(input.content, "utf8").toString("base64"),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    },
  });
  return result.commit.sha;
}

/**
 * Commits several text files to `branch` as one commit on top of `parentSha` (Git Data API: blobs, a tree, a commit,
 * then the ref). Returns the commit sha, or null when the files already have that content (nothing to commit). The ref
 * only moves forward: if the branch moved past `parentSha` meanwhile, GitHub answers 422 and nothing changes.
 */
export async function commitFiles(
  token: string,
  fullName: string,
  input: { branch: string; parentSha: string; message: string; files: { path: string; content: string }[] }
): Promise<string | null> {
  const parent = await githubRequest<{ tree: { sha: string } }>(token, `/repos/${fullName}/git/commits/${input.parentSha}`);
  const entries = await Promise.all(
    input.files.map(async (file) => {
      const blob = await githubRequest<{ sha: string }>(token, `/repos/${fullName}/git/blobs`, {
        method: "POST",
        body: { content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" },
      });
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );
  const tree = await githubRequest<{ sha: string }>(token, `/repos/${fullName}/git/trees`, {
    method: "POST",
    body: { base_tree: parent.tree.sha, tree: entries },
  });
  if (tree.sha === parent.tree.sha) return null;
  const commit = await githubRequest<{ sha: string }>(token, `/repos/${fullName}/git/commits`, {
    method: "POST",
    body: { message: input.message, tree: tree.sha, parents: [input.parentSha] },
  });
  await githubRequest(token, `/repos/${fullName}/git/refs/heads/${encodePath(input.branch)}`, {
    method: "PATCH",
    body: { sha: commit.sha, force: false },
  });
  return commit.sha;
}

export async function deleteRepoFile(token: string, fullName: string, input: { path: string; message: string; branch: string; sha: string }) {
  await githubRequest(token, `/repos/${fullName}/contents/${encodePath(input.path)}`, {
    method: "DELETE",
    body: { message: input.message, branch: input.branch, sha: input.sha },
  });
}

/** Code search (GitHub indexes the default branch only). */
export async function searchRepoCode(token: string, fullName: string, query: string) {
  const params = new URLSearchParams({ q: `${query} repo:${fullName}`, per_page: "20" });
  const result = await githubRequest<{ total_count: number; items: { path: string }[] }>(token, `/search/code?${params}`);
  return { total: result.total_count, paths: result.items.map((item) => item.path) };
}

export type CompareFile = { path: string; status: string; additions: number; deletions: number; patch: string | null };

/** What `head` adds on top of `base`: commit counts and changed files with their patches. */
export async function compareBranches(token: string, fullName: string, base: string, head: string) {
  const result = await githubRequest<{
    status: string;
    ahead_by: number;
    behind_by: number;
    files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
  }>(token, `/repos/${fullName}/compare/${encodePath(base)}...${encodePath(head)}`);
  return {
    aheadBy: result.ahead_by,
    behindBy: result.behind_by,
    files: (result.files ?? []).map(
      (f): CompareFile => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })
    ),
  };
}

// ── Pull requests, checks, issues ─────────────────────────────────────────────

export type GithubPullRequest = {
  id: number;
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  /** null while GitHub is still computing it. */
  mergeable: boolean | null;
  mergeableState: string;
  headSha: string;
};

type ApiPull = {
  id: number;
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged?: boolean;
  merged_at: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head: { sha: string; ref: string };
};

const toPull = (pr: ApiPull): GithubPullRequest => ({
  id: pr.id,
  number: pr.number,
  url: pr.html_url,
  state: pr.state,
  merged: pr.merged ?? pr.merged_at !== null,
  mergeable: pr.mergeable ?? null,
  mergeableState: pr.mergeable_state ?? "unknown",
  headSha: pr.head.sha,
});

export async function createPullRequest(
  token: string,
  fullName: string,
  input: { title: string; body: string; head: string; base: string }
) {
  return toPull(await githubRequest<ApiPull>(token, `/repos/${fullName}/pulls`, { method: "POST", body: input }));
}

/** The open pull request from `head` into `base`, if one exists. */
export async function findOpenPullRequest(token: string, fullName: string, head: string, base: string) {
  const owner = fullName.split("/")[0];
  const params = new URLSearchParams({ state: "open", head: `${owner}:${head}`, base });
  const pulls = await githubRequest<ApiPull[]>(token, `/repos/${fullName}/pulls?${params}`);
  return pulls[0] ? toPull(pulls[0]) : null;
}

export async function getPullRequest(token: string, fullName: string, number: number) {
  return toPull(await githubRequest<ApiPull>(token, `/repos/${fullName}/pulls/${number}`));
}

/** Squash-merges a pull request. Throws GithubError 405 (not mergeable) or 409 (head changed). */
export async function mergePullRequest(token: string, fullName: string, number: number, input: { title: string; sha: string }) {
  await githubRequest(token, `/repos/${fullName}/pulls/${number}/merge`, {
    method: "PUT",
    body: { merge_method: "squash", commit_title: input.title, sha: input.sha },
  });
}

/** Posts a review comment (event COMMENT: GitHub doesn't let the token's own account approve its own pull request). */
export async function createPullReview(token: string, fullName: string, number: number, body: string) {
  await githubRequest(token, `/repos/${fullName}/pulls/${number}/reviews`, { method: "POST", body: { body, event: "COMMENT" } });
}

/** Comments on an issue or a pull request (same API). */
export async function createIssueComment(token: string, fullName: string, number: number, body: string) {
  await githubRequest(token, `/repos/${fullName}/issues/${number}/comments`, { method: "POST", body: { body } });
}

export async function createIssue(token: string, fullName: string, input: { title: string; body: string; labels: string[] }) {
  const issue = await githubRequest<{ id: number; number: number; html_url: string; updated_at: string }>(token, `/repos/${fullName}/issues`, {
    method: "POST",
    body: input,
  });
  return { id: issue.id, number: issue.number, url: issue.html_url, updatedAt: issue.updated_at };
}

export type CheckSummary = {
  /** "success" when every check passed (or there are none), "pending" while any runs, "failure" otherwise. */
  state: "success" | "pending" | "failure";
  checks: {
    name: string;
    status: string;
    conclusion: string | null;
    url: string | null;
    /** Check run id (null for a commit status); a GitHub Actions check run's id is also its job id. */
    id: number | null;
    actions: boolean;
  }[];
};

/** CI state of a commit: GitHub Actions/App check runs plus legacy commit statuses (e.g. deploy previews). */
export async function getCommitChecks(token: string, fullName: string, sha: string): Promise<CheckSummary> {
  const [runs, combined] = await Promise.all([
    githubRequest<{
      check_runs: { id: number; name: string; status: string; conclusion: string | null; html_url: string | null; app: { slug: string } | null }[];
    }>(token, `/repos/${fullName}/commits/${sha}/check-runs?per_page=100`),
    githubRequest<{ statuses: { context: string; state: string; target_url: string | null }[] }>(token, `/repos/${fullName}/commits/${sha}/status`),
  ]);
  const checks = [
    ...runs.check_runs.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      id: run.id,
      actions: run.app?.slug === "github-actions",
    })),
    ...combined.statuses.map((status) => ({
      name: status.context,
      status: status.state === "pending" ? "in_progress" : "completed",
      conclusion: status.state === "pending" ? null : status.state,
      url: status.target_url,
      id: null,
      actions: false,
    })),
  ];
  const failed = checks.some((c) => c.status === "completed" && ["failure", "error", "timed_out", "cancelled", "action_required"].includes(c.conclusion ?? ""));
  const pending = checks.some((c) => c.status !== "completed");
  return { state: failed ? "failure" : pending ? "pending" : "success", checks };
}

/**
 * Whether the repository has its own GitHub Actions workflows (files in .github/workflows; GitHub's dynamic ones, such
 * as Pages deployments, don't run on pull requests). Null when GitHub won't say (e.g. Actions disabled).
 */
export async function hasActionsWorkflows(token: string, fullName: string): Promise<boolean | null> {
  try {
    const data = await githubRequest<{ workflows: { path: string; state: string }[] }>(token, `/repos/${fullName}/actions/workflows?per_page=100`);
    return data.workflows.some((w) => w.path.startsWith(".github/workflows/") && w.state === "active");
  } catch {
    return null;
  }
}

export type CheckAnnotation = { path: string; line: number | null; level: string; message: string };

/** What a check run flagged in the code (compiler, linter and test reporters write these). */
export async function getCheckAnnotations(token: string, fullName: string, checkRunId: number): Promise<CheckAnnotation[]> {
  const rows = await githubRequest<{ path: string; start_line: number | null; annotation_level: string; message: string }[]>(
    token,
    `/repos/${fullName}/check-runs/${checkRunId}/annotations?per_page=50`
  );
  return rows.map((row) => ({ path: row.path, line: row.start_line, level: row.annotation_level, message: row.message }));
}

/**
 * A GitHub Actions job's plain-text log, or null when it's gone. GitHub answers with a redirect to a short-lived signed
 * URL on its storage, which is followed by hand so the token never goes there.
 */
export async function getJobLog(token: string, fullName: string, jobId: number): Promise<string | null> {
  const res = await fetch(`${API}/repos/${fullName}/actions/jobs/${jobId}/logs`, {
    headers: { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
    redirect: "manual",
    cache: "no-store",
  });
  if (res.status === 401) throw new GithubError("GitHub rejected the token.", 401);
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) return null;
  const log = await fetch(location, { cache: "no-store" });
  return log.ok ? log.text() : null;
}

// ── Persistence ────────────────────────────────────────────────────────────────

export async function saveGithubConnection(
  userId: number,
  input: { githubUserId: number; login: string; avatarUrl: string | null; accessToken: string; scope: string | null }
) {
  const values = { ...input, accessToken: encrypt(input.accessToken), updatedAt: new Date() };
  await db
    .insert(githubConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: githubConnections.userId, set: values });
}

/** Public view of the connection (no token) for rendering. */
export async function getGithubAccount(userId: number) {
  const [row] = await db
    .select({ login: githubConnections.login, avatarUrl: githubConnections.avatarUrl })
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId));
  return row ?? null;
}

export async function getGithubToken(userId: number) {
  const [row] = await db
    .select({ accessToken: githubConnections.accessToken })
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId));
  return row ? decrypt(row.accessToken) : null;
}

export async function deleteGithubConnection(userId: number) {
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
}
