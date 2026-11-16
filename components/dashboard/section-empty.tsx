import type { LucideIcon } from "lucide-react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Empty state for a dashboard section that has no data yet. */
export function SectionEmpty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Empty className="surface relative flex-1 overflow-hidden border-solid py-16">
      {/* Decorative backdrop: a dot grid that fades out from the center. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-size-[20px_20px] mask-[radial-gradient(ellipse_50%_55%_at_50%_45%,black,transparent)]"
      />
      <EmptyHeader className="relative">
        <EmptyMedia className="mb-3">
          {/* Halo rings around the tile. */}
          <span className="relative flex items-center justify-center">
            <span aria-hidden className="absolute size-24 rounded-full border border-brand-emphasis/10" />
            <span aria-hidden className="absolute size-17 rounded-full border border-brand-emphasis/15 bg-card/60" />
            <span className="relative flex size-12 items-center justify-center rounded-xl bg-card text-brand-emphasis ring-1 ring-border [&_svg]:size-5.5">
              <Icon />
            </span>
          </span>
        </EmptyMedia>
        <EmptyTitle className="text-lg font-bold">{title}</EmptyTitle>
        <EmptyDescription className="max-w-sm">{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent className="relative">{children}</EmptyContent>}
    </Empty>
  );
}

/** Empty body for a section inside a `surface` that keeps its header (e.g. a list with nothing in it yet). */
export function SurfaceEmpty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 p-6">
      <div className="relative flex min-h-48 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-muted/50 p-6 text-center ring-1 ring-border/70">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_60%_70%_at_50%_50%,black,transparent)]"
        />
        <span className="icon-tile relative text-brand-emphasis">
          <Icon />
        </span>
        <p className="relative text-sm font-semibold">{title}</p>
        <p className="relative max-w-72 text-xs text-muted-foreground">{description}</p>
        {children && <div className="relative">{children}</div>}
      </div>
    </div>
  );
}
