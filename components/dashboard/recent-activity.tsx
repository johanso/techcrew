import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ActivityIcon, ArrowRightIcon } from "lucide-react";

import { ActivityAvatar, actorName } from "@/components/dashboard/activity-kind";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { buttonVariants } from "@/components/ui/button";
import type { ActivityItem } from "@/lib/activity";

export function RecentActivity({ items, activityHref }: { items: ActivityItem[]; activityHref: string }) {
  return (
    <section className="surface flex min-w-0 flex-col">
      <SurfaceHeader
        title="Recent activity"
        description="Latest updates from your agents and team"
        actions={
          <Link href={activityHref} className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}>
            View all
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        }
      />
      {items.length === 0 ? (
        <SurfaceEmpty
          icon={ActivityIcon}
          title="No activity yet"
          description="New cards, agent runs, pull requests and merges show up here as your team works."
        />
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 border-b border-border/70 px-6 py-3.5 last:border-b-0">
              <ActivityAvatar item={item} />

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{actorName(item)}</span>
                  {item.detail && <> · {item.detail}</>}
                </p>
              </div>

              <time
                dateTime={item.at.toISOString()}
                title={format(item.at, "PPpp")}
                className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
              >
                {formatDistanceToNowStrict(item.at, { addSuffix: true })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
