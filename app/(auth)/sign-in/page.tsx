import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TerminalIcon } from "lucide-react";

import { AuthHeader } from "@/components/auth/form-parts";
import { GithubSignIn, PersonalTokenForm } from "@/components/auth/github-sign-in";
import { getCurrentUser } from "@/lib/current-user";
import { githubClientId } from "@/lib/github";
import { isSafeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const nextPath = isSafeRedirectPath(next) ? next : undefined;

  if (await getCurrentUser().catch(() => null)) redirect(nextPath ?? "/workspaces");

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader
        title="Sign in to TechTeam"
        description="One step with GitHub identifies you and lets your agents work on your repositories. There is no password."
      />

      {githubClientId() ? (
        <div className="flex flex-col gap-4">
          <GithubSignIn next={nextPath} />
          <PersonalTokenForm next={nextPath} />
        </div>
      ) : (
        <div className="surface flex flex-col gap-3 p-5">
          <span className="icon-tile text-brand-emphasis">
            <TerminalIcon className="size-5" />
          </span>
          <p className="text-sm font-semibold">Set the GitHub client id first</p>
          <p className="text-sm text-muted-foreground">
            Sign-in uses a GitHub OAuth App with Device Flow enabled. Put its client id in{" "}
            <code className="font-medium text-foreground">.env</code> as{" "}
            <code className="font-medium text-foreground">GITHUB_CLIENT_ID</code>, restart TechTeam and reload this page. The steps are in
            docs/setup.md.
          </p>
          <PersonalTokenForm next={nextPath} />
        </div>
      )}
    </div>
  );
}
