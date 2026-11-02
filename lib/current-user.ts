import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getUserByAuthId, syncUser } from "@/lib/user-sync";

/** App-database user for the current request, or null when signed out. */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  // Sign-in mirrors the user, but fall back to syncing so a missing row never blocks the app.
  return (await getUserByAuthId(session.user.id)) ?? (await syncUser(session.user));
});

/** Like getCurrentUser, but sends signed-out visitors to sign-in and back to `returnTo`. */
export async function requireUser(returnTo: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return user;
}
