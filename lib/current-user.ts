import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getUserById } from "@/lib/local-user";
import { getSessionUserId } from "@/lib/session";

/** App-database user for the current request, or null when signed out (no cookie, a forged or expired one). */
export const getCurrentUser = cache(async () => {
  const userId = await getSessionUserId();
  return userId === null ? null : getUserById(userId);
});

/** Like getCurrentUser, but sends signed-out visitors to sign-in and back to `returnTo`. */
export async function requireUser(returnTo: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return user;
}
