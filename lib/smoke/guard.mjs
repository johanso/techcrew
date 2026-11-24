// `npm run smoke` writes a branch, a file and a pull request into the repository it is given, so it refuses anything
// that doesn't look like a throwaway one. Pure.

/** A repository name (not the owner) must say it is meant to take junk. */
export const THROWAWAY_NAME = /smoke|throwaway|sandbox|scratch/i;

/** @param {string | null | undefined} text @returns {{ owner: string, name: string } | null} */
export function parseRepo(text) {
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(text?.trim() ?? "");
  return match ? { owner: match[1], name: match[2] } : null;
}

/**
 * Before any network call: a repository was given, it is `owner/name`, and its name says it is throwaway
 * (unless the caller overrides that on purpose).
 * @param {{ repo: string | null, anyRepoName: boolean }} input
 * @returns {{ ok: true, repo: string } | { ok: false, message: string }}
 */
export function checkRepoGuard({ repo, anyRepoName }) {
  if (!repo) {
    return { ok: false, message: "No repository given. The smoke test writes a branch, a file and a pull request into it: name a throwaway repository with --repo owner/name (or SMOKE_REPO)." };
  }
  const parsed = parseRepo(repo);
  if (!parsed) return { ok: false, message: `"${repo}" is not a repository name. Use owner/name.` };
  if (!anyRepoName && !THROWAWAY_NAME.test(parsed.name)) {
    return {
      ok: false,
      message: `Refusing ${repo}: its name doesn't contain smoke, throwaway, sandbox or scratch, so it may be a real project. Use a throwaway repository, or pass --i-know-this-repo-gets-junk.`,
    };
  }
  return { ok: true, repo: `${parsed.owner}/${parsed.name}` };
}

/**
 * After GET /repos/{repo}: the token can push to it and it isn't archived.
 * @param {{ full_name?: string, archived?: boolean, permissions?: { push?: boolean } }} apiRepo
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkRepoAccess(apiRepo) {
  const name = apiRepo.full_name ?? "the repository";
  if (apiRepo.archived) return { ok: false, message: `${name} is archived: nothing can be pushed to it.` };
  if (!apiRepo.permissions?.push) return { ok: false, message: `This GitHub token can't push to ${name}. Use a token with the repo scope for an account that can.` };
  return { ok: true };
}
