import Link from "next/link";
import { ZapIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const APP_NAME = "FastNextJS";

/** The square logo on its own (e.g. the collapsed sidebar). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-brand to-action text-brand-accent",
        className
      )}
    >
      <ZapIcon className="size-4 fill-current" />
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex w-fit items-center gap-2.5 font-bold tracking-tight", className)}>
      <BrandMark />
      {APP_NAME}
    </Link>
  );
}
