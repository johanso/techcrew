import "server-only";

import { eq } from "drizzle-orm";

import { db, users } from "@/db";
import type { AuthUser } from "@/lib/auth";

/**
 * Mirrors the auth user into the app database. The first sign-in (email or social)
 * inserts the row; later sign-ins refresh the profile and `lastSignInAt`.
 */
export async function syncUser(user: AuthUser) {
  const now = new Date();
  const profile = {
    name: user.name || null,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image || null,
  };

  const [row] = await db
    .insert(users)
    .values({ authUserId: user.id, ...profile, lastSignInAt: now })
    .onConflictDoUpdate({
      target: users.authUserId,
      set: { ...profile, updatedAt: now, lastSignInAt: now },
    })
    .returning();

  return row;
}

export async function getUserByAuthId(authUserId: string) {
  const [row] = await db.select().from(users).where(eq(users.authUserId, authUserId));
  return row ?? null;
}
