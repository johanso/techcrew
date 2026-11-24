// What `npm run smoke` removes from the GitHub repository afterwards. Pure: the plan only ever names branches under
// `agent/` that appeared during the run, and the open pull requests that come from them.

export const AGENT_BRANCH_PREFIX = "agent/";

/**
 * @param {{ defaultBranch: string, before: string[], after: string[], openPulls: { number: number, head: string }[] }} input
 *   `before` / `after`: every branch name under `agent/` before the run and now; `openPulls`: open PRs with their head branch.
 * @returns {{ closePulls: number[], deleteBranches: string[] }}
 */
export function planCleanup({ defaultBranch, before, after, openPulls }) {
  const known = new Set(before);
  const deleteBranches = [...new Set(after)].filter((name) => name.startsWith(AGENT_BRANCH_PREFIX) && name !== defaultBranch && !known.has(name));
  const doomed = new Set(deleteBranches);
  return { closePulls: openPulls.filter((pull) => doomed.has(pull.head)).map((pull) => pull.number), deleteBranches };
}
