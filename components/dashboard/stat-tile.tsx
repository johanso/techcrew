import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Metric card: label + tinted icon tile on top, large value, one-line hint. `tone` is a text-color
 * class that tints the tile (text-brand-emphasis, text-action, text-success, text-warning …).
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "text-brand-emphasis",
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="surface flex min-w-0 flex-col gap-5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn("icon-tile", tone)}>
          <Icon />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-3xl font-bold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
