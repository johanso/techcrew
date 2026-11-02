"use client";

import { useEffect, useState } from "react";

import { GitHubIcon, GoogleIcon } from "@/components/auth/brand-icons";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "google", label: "Google", Icon: GoogleIcon },
  { id: "github", label: "GitHub", Icon: GitHubIcon },
] as const;

export function SocialButtons({ next }: { next?: string }) {
  const [pending, setPending] = useState<string | null>(null);

  // Clear the spinner when the user comes back from the provider via the Back button (bfcache).
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setPending(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const query = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="grid grid-cols-2 gap-3">
      {PROVIDERS.map(({ id, label, Icon }) => (
        <a
          key={id}
          href={`/api/auth/social/${id}${query}`}
          onClick={(event) => {
            if (pending) event.preventDefault();
            else setPending(id);
          }}
          aria-disabled={pending !== null}
          aria-label={`Continue with ${label}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 gap-2 text-sm shadow-xs",
            pending && pending !== id && "pointer-events-none opacity-50"
          )}
        >
          {pending === id ? <Spinner /> : <Icon className="size-4" />}
          {label}
        </a>
      ))}
    </div>
  );
}
