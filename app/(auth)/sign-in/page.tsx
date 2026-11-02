import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthDivider, AuthHeader } from "@/components/auth/form-parts";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SocialButtons } from "@/components/auth/social-buttons";
import { getSession, isSafeRedirectPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const nextPath = isSafeRedirectPath(next) ? next : undefined;

  if (await getSession().catch(() => null)) redirect(nextPath ?? "/workspaces");

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title="Welcome back" description="Sign in to your account to continue." />

      <div className="flex flex-col gap-6">
        <SocialButtons next={nextPath} />
        <AuthDivider />
        <SignInForm next={nextPath} />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href={nextPath ? `/sign-up?next=${encodeURIComponent(nextPath)}` : "/sign-up"}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
