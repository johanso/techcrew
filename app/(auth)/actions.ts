"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AuthError,
  SESSION_COOKIE,
  SOCIAL_NEXT_COOKIE,
  clearSessionCookie,
  fetchSession,
  isSafeRedirectPath,
  revokeSession,
  setSessionCookie,
  signInWithEmail,
  signUpWithEmail,
} from "@/lib/auth";
import { syncUser } from "@/lib/user-sync";

const DEFAULT_REDIRECT = "/workspaces";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthFormState = {
  status?: "error" | "verify-email";
  message?: string;
  errors?: Partial<Record<"name" | "email" | "password", string>>;
  fields?: { name?: string; email?: string };
};

function safeRedirectPath(value: unknown) {
  return isSafeRedirectPath(value) ? value : DEFAULT_REDIRECT;
}

function friendlyMessage(error: unknown) {
  if (!(error instanceof AuthError)) {
    console.error("[auth]", error);
    return "Something went wrong. Please try again.";
  }
  switch (error.status) {
    case 401:
      return "Incorrect email or password.";
    case 403:
      return "Please verify your email address before signing in. Check your inbox for the link.";
    case 429:
      return "Too many attempts. Please wait a moment and try again.";
    case 503:
      return "Sign-in is temporarily unavailable. Please try again in a minute.";
    default:
      return error.message;
  }
}

/** Validates the token, stores it in an HTTP-only cookie and mirrors the user into the database. */
async function startSession(token: string) {
  const session = await fetchSession(token);
  if (!session) throw new AuthError("Your session could not be verified.", 401);
  await setSessionCookie(token, new Date(session.session.expiresAt));
  await syncUser(session.user);
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fields = { name, email };

  const errors: AuthFormState["errors"] = {};
  if (!name) errors.name = "Enter your full name.";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Password must be at least 8 characters.";
  if (Object.keys(errors).length) return { status: "error", errors, fields };

  try {
    const { token } = await signUpWithEmail({ name, email, password });
    // No token means the project requires email verification before the first sign-in.
    if (!token) {
      return {
        status: "verify-email",
        message: `We sent a verification link to ${email}. Open it to activate your account.`,
        fields,
      };
    }
    await startSession(token);
  } catch (error) {
    if (error instanceof AuthError && error.status === 422) {
      return {
        status: "error",
        errors: { email: "An account with this email already exists." },
        fields,
      };
    }
    return { status: "error", message: friendlyMessage(error), fields };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fields = { email };

  const errors: AuthFormState["errors"] = {};
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  if (Object.keys(errors).length) return { status: "error", errors, fields };

  try {
    const { token } = await signInWithEmail({ email, password });
    await startSession(token);
  } catch (error) {
    return { status: "error", message: friendlyMessage(error), fields };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

/** Called by /auth/callback with the token the provider flow returned in the URL fragment. */
export async function completeSocialSignIn(token: string): Promise<{ error: string }> {
  const cookieStore = await cookies();
  const next = safeRedirectPath(cookieStore.get(SOCIAL_NEXT_COOKIE)?.value);
  cookieStore.delete(SOCIAL_NEXT_COOKIE);

  try {
    await startSession(token);
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      return { error: "This sign-in link is invalid or has expired. Please try again." };
    }
    return { error: friendlyMessage(error) };
  }

  redirect(next);
}

export async function signOut() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  await clearSessionCookie();
  redirect("/sign-in");
}
