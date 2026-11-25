import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TerminalIcon } from "lucide-react";

import { AuthHeader } from "@/components/auth/form-parts";
import { GithubSignIn, PersonalTokenForm } from "@/components/auth/github-sign-in";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/current-user";
import { githubClientId } from "@/lib/github";
import { isSafeRedirectPath, safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, reconnect } = await searchParams;
  const nextPath = isSafeRedirectPath(next) ? next : undefined;

  const user = await getCurrentUser().catch(() => null);
  // Someone signed in only stays here to authorize GitHub again (reconnectHref in lib/safe-redirect.ts).
  const reconnecting = Boolean(user) && reconnect === "1";
  if (user && !reconnecting) redirect(safeNext(next));

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader
        title={reconnecting ? "Reconnect GitHub" : "Sign in to TechTeam"}
        description={
          reconnecting
            ? "GitHub rejected the saved connection. Authorize again to keep your agents working."
            : "One step with GitHub identifies you and lets your agents work on your repositories. There is no password."
        }
      />

      {githubClientId() ? (
        <div className="flex flex-col gap-4">
          {/* Reconnecting has its own Cancel (leave the page), so stopping the code reads differently. */}
          <GithubSignIn next={nextPath} stopLabel={reconnecting ? "Stop waiting" : undefined} />
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

      {reconnecting && (
        <Link href={safeNext(next)} className={buttonVariants({ variant: "ghost", className: "h-10" })}>
          Cancel
        </Link>
      )}
    </div>
  );
}
