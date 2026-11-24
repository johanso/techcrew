import "server-only";

import { DISABLED_MESSAGE, pollDeviceFlow, requestDeviceCode, type DeviceFlowState } from "@/lib/device-flow";
import { GithubError, getGithubIdentity, githubClientId, saveGithubConnection, verifyPersonalToken } from "@/lib/github";
import { adoptUser, createGithubUser, resolveGithubSignIn } from "@/lib/local-user";
import { isSafeRedirectPath } from "@/lib/safe-redirect";
import { ADOPT_COOKIE, ADOPT_TTL_MS, LOGIN_COOKIE } from "@/lib/session-config";
import { clearCookie, readSealedCookie, startSession, writeSealedCookie } from "@/lib/session";
import type { GithubIdentity } from "@/lib/user-identity";

/** What the sign-in page shows after each step (the device code itself never leaves the server). */
export type SignInStep =
  | { status: "waiting"; userCode: string; verificationUri: string; expiresAt: number; retryInMs: number }
  | { status: "pending"; retryInMs: number }
  | { status: "done"; next: string }
  | { status: "adopt" }
  | { status: "denied" | "expired" }
  | { status: "error" | "disabled" | "not-configured"; message: string };

const DEFAULT_NEXT = "/workspaces";
const NOT_CONFIGURED =
  "No GitHub client id is configured. Set GITHUB_CLIENT_ID to the client id of a GitHub OAuth App with Device Flow enabled, then restart (docs/setup.md).";
const TOKEN_REFUSED = "GitHub didn't accept that token, or it can't read repositories. Create a token with the repo scope.";

export const safeNext = (value: unknown) => (isSafeRedirectPath(value) ? value : DEFAULT_NEXT);

const isFlowState = (value: unknown): value is DeviceFlowState => {
  const state = value as Partial<DeviceFlowState> | null;
  return (
    typeof state?.deviceCode === "string" &&
    typeof state.intervalSec === "number" &&
    typeof state.expiresAtMs === "number" &&
    typeof state.lastPollAtMs === "number"
  );
};

type LoginCookie = { state: DeviceFlowState; next: string };

async function readLogin(): Promise<LoginCookie | null> {
  const value = (await readSealedCookie(LOGIN_COOKIE)) as { state?: unknown; next?: unknown } | null;
  return value && isFlowState(value.state) ? { state: value.state, next: safeNext(value.next) } : null;
}

/** Starts the device flow: GitHub's user code to show, the device code into a sealed cookie. */
export async function startDeviceSignIn(next: unknown): Promise<SignInStep> {
  const clientId = githubClientId();
  if (!clientId) return { status: "not-configured", message: NOT_CONFIGURED };

  const now = Date.now();
  const result = await requestDeviceCode(fetch, clientId, now);
  if (!result.ok) return { status: result.reason === "disabled" ? "disabled" : "error", message: result.message };

  await writeSealedCookie(LOGIN_COOKIE, { state: result.state, next: safeNext(next) }, result.state.expiresAtMs - now);
  return {
    status: "waiting",
    userCode: result.userCode,
    verificationUri: result.verificationUri,
    expiresAt: result.state.expiresAtMs,
    retryInMs: result.state.intervalSec * 1000,
  };
}

/** One poll of the device flow; on success signs in (or asks to adopt) and clears the sign-in cookie. */
export async function pollDeviceSignIn(): Promise<SignInStep> {
  const clientId = githubClientId();
  if (!clientId) return { status: "not-configured", message: NOT_CONFIGURED };
  const login = await readLogin();
  if (!login) return { status: "expired" };

  const result = await pollDeviceFlow(fetch, clientId, login.state, Date.now());
  switch (result.status) {
    case "pending":
      if (result.state !== login.state) {
        await writeSealedCookie(LOGIN_COOKIE, { state: result.state, next: login.next }, result.state.expiresAtMs - Date.now());
      }
      return { status: "pending", retryInMs: result.retryInMs };
    case "success":
      try {
        return await completeSignIn(result.accessToken, result.scope, login.next);
      } catch (error) {
        console.error("[sign-in] finishing the device flow failed", error);
        return { status: "error", message: "GitHub signed you in, but we couldn't finish. Please try again." };
      }
    case "disabled":
      await clearCookie(LOGIN_COOKIE);
      return { status: "disabled", message: DISABLED_MESSAGE };
    case "error":
      await clearCookie(LOGIN_COOKIE);
      return { status: "error", message: result.message };
    default:
      await clearCookie(LOGIN_COOKIE);
      return { status: result.status };
  }
}

/** A personal access token instead of the device flow: verified with GitHub, then handled like its result. */
export async function signInWithPersonalToken(token: string, next: unknown): Promise<SignInStep> {
  const trimmed = token.trim();
  if (!trimmed) return { status: "error", message: "Paste a personal access token." };
  try {
    await verifyPersonalToken(trimmed);
    return await completeSignIn(trimmed, null, safeNext(next));
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 403)) return { status: "error", message: TOKEN_REFUSED };
    console.error("[sign-in] personal token failed", error);
    return { status: "error", message: "We couldn't check that token with GitHub. Try again in a moment." };
  }
}

/** Identity and repository access in one step: resolve the user, save the token, open the session. */
async function completeSignIn(accessToken: string, scope: string | null, next: string): Promise<SignInStep> {
  const identity = await getGithubIdentity(accessToken);
  const outcome = await resolveGithubSignIn(identity);
  await clearCookie(LOGIN_COOKIE);

  if (outcome.kind === "needs-adoption") {
    await writeSealedCookie(ADOPT_COOKIE, { identity, accessToken, scope, next, userId: outcome.userId }, ADOPT_TTL_MS, { encrypted: true });
    return { status: "adopt" };
  }
  await saveGithubConnection(outcome.user.id, { ...identityFields(identity), accessToken, scope });
  await startSession(outcome.user.id);
  return { status: "done", next };
}

const identityFields = (identity: GithubIdentity) => ({
  githubUserId: identity.githubUserId,
  login: identity.login,
  avatarUrl: identity.avatarUrl,
});

export type PendingAdoption = {
  identity: GithubIdentity;
  accessToken: string;
  scope: string | null;
  next: string;
  userId: number;
};

/** The sign-in waiting for the owner's answer, or null (none, expired, forged). */
export async function readPendingAdoption(): Promise<PendingAdoption | null> {
  const value = (await readSealedCookie(ADOPT_COOKIE, { encrypted: true })) as Partial<PendingAdoption> | null;
  const identity = value?.identity;
  if (
    !value ||
    typeof identity?.githubUserId !== "number" ||
    typeof identity.login !== "string" ||
    typeof value.accessToken !== "string" ||
    typeof value.userId !== "number"
  ) {
    return null;
  }
  return {
    identity: { githubUserId: identity.githubUserId, login: identity.login, name: identity.name ?? null, avatarUrl: identity.avatarUrl ?? null },
    accessToken: value.accessToken,
    scope: value.scope ?? null,
    next: safeNext(value.next),
    userId: value.userId,
  };
}

/** The owner's answer on the adopt page: `adopt` hands them the existing data, otherwise a separate account is made. */
export async function answerAdoption(adopt: boolean): Promise<string | null> {
  const pending = await readPendingAdoption();
  if (!pending) return null;

  const user = adopt ? await adoptUser(pending.userId, pending.identity) : await createGithubUser(pending.identity);
  if (!user) return null;
  await saveGithubConnection(user.id, { ...identityFields(pending.identity), accessToken: pending.accessToken, scope: pending.scope });
  await startSession(user.id);
  await clearCookie(ADOPT_COOKIE);
  return pending.next;
}
