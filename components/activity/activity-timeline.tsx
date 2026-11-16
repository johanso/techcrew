import Link from "next/link";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { ChevronDownIcon } from "lucide-react";

import { ActivityAvatar, actorName } from "@/components/dashboard/activity-kind";
import { buttonVariants } from "@/components/ui/button";
import { formatMicros } from "@/lib/agent-config";
import type { ActivityItem, ActivityKind } from "@/lib/activity";
import { cn } from "@/lib/utils";

/** Kinds that call a model: their cost shows even when it's $0.00 (e.g. simulated agents). */
const SPEND_KINDS: ActivityKind[] = ["task_run", "generated"];

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/** Items grouped by calendar day, newest first (the server already sorts). */
function groupByDay(items: ActivityItem[]) {
  const groups: { label: string; items: ActivityItem[]; costMicros: number }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.items.push(item);
      last.costMicros += item.costMicros;
    } else groups.push({ label, items: [item], costMicros: item.costMicros });
  }
  return groups;
}

/** The Activity page's timeline. `olderHref` links to a longer list when there is more history. */
export function ActivityTimeline({ items, olderHref }: { items: ActivityItem[]; olderHref: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {groupByDay(items).map((group) => (
        <section key={group.label} aria-label={group.label} className="surface flex min-w-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-3">
            <h2 className="eyebrow text-muted-foreground">{group.label}</h2>
            {group.costMicros > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{formatMicros(group.costMicros)}</span> spent
              </p>
            )}
          </div>
          <ol className="flex flex-col">
            {group.items.map((item, index) => {
              const showCost = item.costMicros > 0 || SPEND_KINDS.includes(item.kind);
              return (
                // Zebra rows: every other event on a barely-there grey, so a long day doesn't read as one white block.
                <li key={item.id} className="relative flex gap-4 px-6 py-4 even:bg-muted/25">
                  {/* Timeline rail between consecutive events. */}
                  {index < group.items.length - 1 && <span aria-hidden className="absolute top-14 -bottom-2 left-10 z-10 w-px bg-border" />}
                  <ActivityAvatar item={item} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold">{item.title}</p>
                      {showCost && (
                        <p
                          title="What the agent spent on models for this step"
                          className={cn(
                            "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-border/70",
                            item.costMicros === 0 && "font-medium text-muted-foreground"
                          )}
                        >
                          <span className="sr-only">Cost: </span>
                          {formatMicros(item.costMicros)}
                        </p>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{actorName(item)}</span>
                      {" · "}
                      <time dateTime={item.at.toISOString()} title={format(item.at, "PPpp")}>
                        {format(item.at, "h:mm a")}
                        {/* The day heading already dates older events; today's also get a relative time. */}
                        {isToday(item.at) && ` · ${formatDistanceToNowStrict(item.at, { addSuffix: true })}`}
                      </time>
                    </p>
                    {item.detail && <p className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {olderHref && (
        <Link href={olderHref} scroll={false} className={buttonVariants({ variant: "outline", className: "h-9 self-center" })}>
          Show older activity
          <ChevronDownIcon data-icon="inline-end" />
        </Link>
      )}
    </div>
  );
}
