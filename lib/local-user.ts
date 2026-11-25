import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, githubConnections, users, type User } from "@/db";
import {
  noreplyEmail,
  resolveUser,
  type GithubIdentity,
} from "@/lib/user-identity";

/** Serializes sign-ins: two at once (two tabs, a double click) can never both create a user. */
const SIGN_IN_LOCK = 4_070_001;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SignInOutcome =
  | { kind: "signed-in"; user: User }
  /** The database holds one user that isn't tied to GitHub yet: the owner must confirm (app/(auth)/sign-in/adopt). */
  | { kind: "needs-adoption"; userId: number; email: string };

async function insertUser(tx: Tx, identity: GithubIdentity) {
  const now = new Date();
  const profile = { name: identity.name ?? identity.login, image: identity.avatarUrl, updatedAt: now, lastSignInAt: now };
  const [row] = await tx
    .insert(users)
    .values({
      githubUserId: identity.githubUserId,
      email: noreplyEmail(identity),
      emailVerified: true,
      ...profile,
    })
    // Belt and braces next to the lock: a second insert for the same account just signs it in.
    .onConflictDoUpdate({ target: users.githubUserId, set: { lastSignInAt: now, updatedAt: now } })
    .returning();
  return row;
}

async function touch(tx: Tx, userId: number, identity: GithubIdentity, link: boolean) {
  const now = new Date();
  const [row] = await tx
    .update(users)
    .set({
      ...(link ? { githubUserId: identity.githubUserId } : {}),
      // Fill in a missing profile, never overwrite the owner's own.
      name: sql`coalesce(${users.name}, ${identity.name ?? identity.login})`,
      image: sql`coalesce(${users.image}, ${identity.avatarUrl})`,
      updatedAt: now,
      lastSignInAt: now,
    })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

/** Finds, links or creates the user of a GitHub sign-in (rules in lib/user-identity.ts). */
export async function resolveGithubSignIn(identity: GithubIdentity): Promise<SignInOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SIGN_IN_LOCK})`);
    const rows = await tx.select({ id: users.id, githubUserId: users.githubUserId, email: users.email }).from(users);
    const connections = await tx
      .select({ userId: githubConnections.userId, githubUserId: githubConnections.githubUserId })
      .from(githubConnections)
      .where(eq(githubConnections.githubUserId, identity.githubUserId));

    const resolution = resolveUser(identity, rows, connections);
    switch (resolution.kind) {
      case "existing":
        return { kind: "signed-in", user: await touch(tx, resolution.userId, identity, resolution.link) };
      case "confirm-adoption":
        return { kind: "needs-adoption", userId: resolution.userId, email: resolution.email };
      case "create":
        return { kind: "signed-in", user: await insertUser(tx, identity) };
    }
  });
}

/**
 * Signs this existing user in with this GitHub account, tying them to it ("adopt it", or a signed-in reconnect).
 * Refused (null) when the user is gone or tied to another account, or the account belongs to another user.
 */
export async function adoptUser(userId: number, identity: GithubIdentity): Promise<User | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SIGN_IN_LOCK})`);
    const [row] = await tx.select({ githubUserId: users.githubUserId }).from(users).where(eq(users.id, userId));
    if (!row) return null;
    if (row.githubUserId !== null && row.githubUserId !== identity.githubUserId) return null;
    const [holder] = await tx.select({ id: users.id }).from(users).where(eq(users.githubUserId, identity.githubUserId));
    if (holder && holder.id !== userId) return null;
    return touch(tx, userId, identity, true);
  });
}

/** The owner's answer "create a separate account". */
export async function createGithubUser(identity: GithubIdentity): Promise<User> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SIGN_IN_LOCK})`);
    return insertUser(tx, identity);
  });
}

/** The user with this id, or null (a session for a deleted user is signed out). */
export async function getUserById(id: number) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}
