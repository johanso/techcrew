/**
 * The client id of the project's GitHub OAuth App (Device Flow enabled). A client id is public and there is no client
 * secret, so it ships in the code. A fork, or anyone who wants their own app, sets GITHUB_CLIENT_ID.
 */
export const DEFAULT_GITHUB_CLIENT_ID = "Ov23liY9eiTmtnf5u8uu";

/** GITHUB_CLIENT_ID (trimmed, non-empty) wins over the default; null only if both resolve to nothing. */
export function resolveGithubClientId(env: Record<string, string | undefined>, fallback: string = DEFAULT_GITHUB_CLIENT_ID) {
  return env.GITHUB_CLIENT_ID?.trim() || fallback.trim() || null;
}
