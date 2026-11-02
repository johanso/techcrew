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

async function githubRequest<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
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
