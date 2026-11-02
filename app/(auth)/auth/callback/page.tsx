"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";

import { completeSocialSignIn } from "@/app/(auth)/actions";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Landing page for GitHub / Google sign-in. The auth service appends `#token=…` (or `#error=…`);
 * the fragment never reaches a server, so we read it here, strip it from the URL and hand the
 * token to a server action that stores it in an HTTP-only cookie.
 */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    // Strip the token from the address bar. Deferred one tick so Next's router, whose history
    // integration mounts after this effect, records the clean URL and doesn't restore the hash.
    setTimeout(() => window.history.replaceState(null, "", window.location.pathname));

    const finish = async () => {
      if (!token) {
        setError(
          params.get("error")
            ? "Sign-in with your provider was not completed. Please try again."
            : "This sign-in link is invalid or has expired."
        );
        return;
      }
      try {
        const result = await completeSocialSignIn(token);
        if (result?.error) setError(result.error);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    };
    finish();
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleAlertIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold">We couldn&apos;t sign you in</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Link href="/sign-in" className={buttonVariants({ className: "h-10 w-full" })}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status">
      <Spinner className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">Signing you in…</h1>
        <p className="text-sm text-muted-foreground">Hang tight, we&apos;re setting up your session.</p>
      </div>
    </div>
  );
}
