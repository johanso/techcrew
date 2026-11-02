import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthDivider, AuthHeader } from "@/components/auth/form-parts";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SocialButtons } from "@/components/auth/social-buttons";
import { getSession, isSafeRedirectPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  const nextPath = isSafeRedirectPath(next) ? next : undefined;

  if (await getSession().catch(() => null)) redirect(nextPath ?? "/workspaces");

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title="Create your account" description="Get started in less than a minute. No credit card required." />

      <div className="flex flex-col gap-6">
        <SocialButtons next={nextPath} />
        <AuthDivider />
        <SignUpForm next={nextPath} />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in"}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
