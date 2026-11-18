import { cn } from "@/lib/utils";

export type BarListItem = {
  key: string;
  /** Name of the row: text, optionally with an icon or avatar before it. */
  label: React.ReactNode;
  /** Plain-text name for screen readers when `label` holds more than text. */
  name: string;
  value: number;
  /** The value as shown ("3", "$1.20", "40%"). */
  display: string;
};

/**
 * Ranked horizontal bars, one hue, each row labeled with its name and value (the values are all printed, so nothing
 * hides behind a hover). Bars grow from one baseline, scaled to the largest value; a zero draws no bar.
 */
export function BarList({ items, className }: { items: BarListItem[]; className?: string }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  return (
    <ul className={cn("flex flex-col gap-4", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2" aria-hidden>
              {item.label}
            </span>
            <span className="sr-only">{item.name}:</span>
            <span className="shrink-0 font-semibold tabular-nums">{item.display}</span>
          </div>
          <div aria-hidden className="h-2">
            {item.value > 0 && max > 0 && (
              <div className="h-full rounded-r-[4px] bg-brand-emphasis" style={{ width: `${Math.max((item.value / max) * 100, 1)}%` }} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
