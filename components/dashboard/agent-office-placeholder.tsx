import { Building2Icon } from "lucide-react";

import { SurfaceHeader } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";

/** Placeholder for the AI Agent Office Space. The real office view replaces the body. */
export function AgentOfficePlaceholder({ className }: { className?: string }) {
  return (
    <section className={cn("surface flex min-w-0 flex-col", className)}>
      <SurfaceHeader
        title="AI Agent Office Space"
        description="See your agents at work"
        actions={
          <span className="eyebrow rounded-full bg-muted px-2.5 py-1 text-muted-foreground ring-1 ring-border">Soon</span>
        }
      />
      <div className="flex flex-1 p-6">
        <div className="relative flex min-h-64 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-muted/50 p-6 text-center ring-1 ring-border/70">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-size-[16px_16px]"
          />
          <span className="icon-tile relative text-brand-emphasis">
            <Building2Icon />
          </span>
          <p className="relative text-sm font-semibold">The office is being built</p>
          <p className="relative max-w-56 text-xs text-muted-foreground">
            Your agents will have desks here, so you can see who is doing what.
          </p>
        </div>
      </div>
    </section>
  );
}
