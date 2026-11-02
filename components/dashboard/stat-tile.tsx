import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Small metric card: tinted icon tile, label, value. `tone` is a text-color class that
 * tints the tile (text-brand-emphasis, text-action, text-success, text-warning …).
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
    <div className="surface flex flex-col gap-4 p-5">
      <span className={cn("icon-tile", tone)}>
        <Icon />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-bold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
