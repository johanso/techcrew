// Sign-in finds the owner through `users.github_user_id` (lib/user-identity.ts), and the GitHub connections are not in
// an archive. So an exported user that has no GitHub id yet (a user of the old hosted setup) gets the one its saved
// connection had, and the restored user is recognized directly at the next sign-in. Pure; the source is never changed.

/**
 * @param {Record<string, unknown>[]} users exported `users` rows
 * @param {{ userId: number; githubUserId: string | number }[]} connections `github_connections` of the source
 * @returns {{ users: Record<string, unknown>[]; filled: number }}
 */
export function backfillGithubUserIds(users, connections) {
  const taken = new Set(users.map((user) => user.github_user_id).filter((id) => id !== null && id !== undefined).map(String));
  const byUser = new Map(connections.map((connection) => [connection.userId, String(connection.githubUserId)]));
  let filled = 0;
  const result = users.map((user) => {
    if (user.github_user_id !== null && user.github_user_id !== undefined) return user;
    const githubUserId = byUser.get(/** @type {number} */ (user.id));
    // github_user_id is unique: a connection id another user already has can't be given to a second one.
    if (githubUserId === undefined || taken.has(githubUserId)) return user;
    taken.add(githubUserId);
    filled += 1;
    return { ...user, github_user_id: githubUserId };
  });
  return { users: result, filled };
}
