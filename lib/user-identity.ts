// Which TechTeam user a GitHub sign-in is, as pure rules over plain rows (the database part is lib/local-user.ts).

export type GithubIdentity = {
  githubUserId: number;
  login: string;
  /** The profile name, or null when the account has none. */
  name: string | null;
  avatarUrl: string | null;
};

export type UserRow = { id: number; githubUserId: number | null; email: string };
export type ConnectionRow = { userId: number; githubUserId: number };

export type Resolution =
  /** Sign in as this user; `link` = set its github_user_id first (it was found through its saved connection). */
  | { kind: "existing"; userId: number; link: boolean }
  /** The database holds exactly one user with no GitHub id: ask before handing them this account. */
  | { kind: "confirm-adoption"; userId: number; email: string }
  | { kind: "create" };

/**
 * a. a user with that GitHub id; b. a user whose saved connection has it (and no GitHub id of its own yet);
 * c. exactly one user in the database, not tied to another GitHub account: needs the owner's confirmation;
 * d. otherwise a new user.
 */
export function resolveUser(identity: GithubIdentity, users: UserRow[], connections: ConnectionRow[]): Resolution {
  const direct = users.find((user) => user.githubUserId === identity.githubUserId);
  if (direct) return { kind: "existing", userId: direct.id, link: false };

  const viaConnection = connections
    .filter((connection) => connection.githubUserId === identity.githubUserId)
    .map((connection) => users.find((user) => user.id === connection.userId))
    .filter((user): user is UserRow => user !== undefined && user.githubUserId === null)
    .sort((a, b) => a.id - b.id)[0];
  if (viaConnection) return { kind: "existing", userId: viaConnection.id, link: true };

  if (users.length === 1 && users[0].githubUserId === null) {
    return { kind: "confirm-adoption", userId: users[0].id, email: users[0].email };
  }
  return { kind: "create" };
}

export type SessionSignIn =
  /** Nobody is signed in: resolveUser decides who this is. */
  | { kind: "signed-out" }
  /** The signed-in user authorized their own account again (or their first one): save the new token for them. */
  | { kind: "reconnect"; userId: number }
  /** Refused: the session, the saved connection and every user stay as they are. */
  | { kind: "different-account" };

/**
 * What a finished GitHub authorization may do while `session` is the signed-in user (null: signed out). A signed-in
 * browser only ever reconnects its own user: another account never switches the session, creates or adopts a user.
 */
export function sessionSignIn(identity: Pick<GithubIdentity, "githubUserId">, session: Pick<UserRow, "id" | "githubUserId"> | null): SessionSignIn {
  if (!session) return { kind: "signed-out" };
  if (session.githubUserId !== null && session.githubUserId !== identity.githubUserId) return { kind: "different-account" };
  return { kind: "reconnect", userId: session.id };
}

/** Why a `different-account` authorization was refused. */
export function differentAccountMessage(login: string) {
  return `That is a different GitHub account (@${login}). Authorize with the account you signed in with, or sign out first.`;
}

/** GitHub's no-reply address of an account: unique per GitHub id and needs no extra OAuth scope. */
export function noreplyEmail(identity: Pick<GithubIdentity, "githubUserId" | "login">) {
  return `${identity.githubUserId}+${identity.login}@users.noreply.github.com`;
}
