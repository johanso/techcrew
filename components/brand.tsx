import Link from "next/link";
import { ZapIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex w-fit items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-accent shadow-sm">
        <ZapIcon className="size-4 fill-current" />
      </span>
      FastNextJS
    </Link>
  );
}
