// The few GitHub REST calls `npm run smoke` makes itself (the app's own calls are the thing under test). The token goes
// only in the Authorization header; errors name the method, the path and the status, never the header.
import { AGENT_BRANCH_PREFIX } from "./cleanup.mjs";

const API = "https://api.github.com";

/**
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 */
export function githubClient(token, fetchImpl = fetch) {
  /** @param {string} method @param {string} path @param {unknown} [body] @param {number[]} [allow] extra statuses that are an answer, not an error */
  async function call(method, path, body, allow = []) {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "techteam-smoke",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok && !allow.includes(response.status)) throw new Error(`GitHub ${method} ${path} answered ${response.status}`);
    return { status: response.status, json: response.status === 204 || response.status === 404 ? null : await response.json().catch(() => null) };
  }

  return {
    user: async () => (await call("GET", "/user")).json,
    repo: async (/** @type {string} */ repo) => {
      const out = await call("GET", `/repos/${repo}`, undefined, [404]);
      return out.status === 404 ? null : out.json;
    },
    /** Names of every branch under agent/. */
    agentBranches: async (/** @type {string} */ repo) => {
      const refs = (await call("GET", `/repos/${repo}/git/matching-refs/heads/${AGENT_BRANCH_PREFIX}?per_page=100`)).json ?? [];
      return refs.map((ref) => String(ref.ref).replace(/^refs\/heads\//, ""));
    },
    /** Open pull requests with their head branch (same repository only). */
    openPulls: async (/** @type {string} */ repo) => {
      const pulls = (await call("GET", `/repos/${repo}/pulls?state=open&per_page=100`)).json ?? [];
      return pulls.filter((pull) => pull.head?.repo?.full_name === repo).map((pull) => ({ number: pull.number, head: String(pull.head.ref) }));
    },
    pull: async (/** @type {string} */ repo, /** @type {number} */ number) => (await call("GET", `/repos/${repo}/pulls/${number}`)).json,
    branchExists: async (/** @type {string} */ repo, /** @type {string} */ branch) => (await call("GET", `/repos/${repo}/git/ref/heads/${branch}`, undefined, [404])).status === 200,
    fileExists: async (/** @type {string} */ repo, /** @type {string} */ file, /** @type {string} */ ref) =>
      (await call("GET", `/repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, undefined, [404])).status === 200,
    closePull: (/** @type {string} */ repo, /** @type {number} */ number) => call("PATCH", `/repos/${repo}/pulls/${number}`, { state: "closed" }),
    deleteBranch: (/** @type {string} */ repo, /** @type {string} */ branch) => call("DELETE", `/repos/${repo}/git/refs/heads/${branch}`, undefined, [404, 422]),
  };
}
