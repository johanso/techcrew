"use server";

import { redirect } from "next/navigation";

import {
  answerAdoption,
  pollDeviceSignIn,
  signInWithPersonalToken,
  startDeviceSignIn,
  type SignInStep,
} from "@/lib/sign-in";
import { LOGIN_COOKIE } from "@/lib/session-config";
import { clearCookie, clearSessionCookie } from "@/lib/session";

export type TokenFormState = { message?: string };

/** "Continue with GitHub": asks GitHub for a code to show. */
export async function startGithubSignIn(next?: string): Promise<SignInStep> {
  return startDeviceSignIn(next);
}

/** Called by the page every interval while the owner authorizes on GitHub. */
export async function pollGithubSignIn(): Promise<SignInStep> {
  return pollDeviceSignIn();
}

export async function cancelGithubSignIn() {
  await clearCookie(LOGIN_COOKIE);
}

/** The secondary path: a personal access token. */
export async function signInWithToken(_prev: TokenFormState, formData: FormData): Promise<TokenFormState> {
  const result = await signInWithPersonalToken(String(formData.get("token") ?? ""), formData.get("next"));
  if (result.status === "done") redirect(result.next);
  if (result.status === "adopt") redirect("/sign-in/adopt");
  return { message: "message" in result ? result.message : "That didn't work. Please try again." };
}

/** The adopt page's two answers: take over the existing data, or start a separate account. */
export async function adoptExistingData() {
  const next = await answerAdoption(true);
  redirect(next ?? "/sign-in");
}

export async function createSeparateAccount() {
  const next = await answerAdoption(false);
  redirect(next ?? "/sign-in");
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/sign-in");
}
