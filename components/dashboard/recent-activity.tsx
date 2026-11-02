import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CirclePlusIcon,
  EyeIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";

import { AgentAvatar, UserInitial } from "@/components/dashboard/agent-avatar";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import type { ActivityItem, ActivityKind } from "@/lib/overview";
import { cn } from "@/lib/utils";

const KIND: Record<ActivityKind, { icon: LucideIcon; tone: string }> = {
  task_completed: { icon: CircleCheckIcon, tone: "text-success" },
  pr_opened: { icon: GitPullRequestIcon, tone: "text-brand-emphasis" },
  commits_pushed: { icon: GitCommitHorizontalIcon, tone: "text-action" },
  review_requested: { icon: EyeIcon, tone: "text-warning" },
  task_assigned: { icon: UserPlusIcon, tone: "text-brand-emphasis" },
  task_created: { icon: CirclePlusIcon, tone: "text-muted-foreground" },
};

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
      <ul className="flex flex-col">
        {items.map((item) => {
          const kind = KIND[item.kind];
          const actorName = item.actor.type === "agent" ? item.actor.agent.name : item.actor.name;
          return (
            <li
              key={item.id}
              className="flex items-center gap-4 border-b border-border/70 px-6 py-3.5 last:border-b-0"
            >
              <span className="relative shrink-0">
                {item.actor.type === "agent" ? (
                  <AgentAvatar agent={item.actor.agent} className="size-8" />
                ) : (
                  <UserInitial name={item.actor.name} className="size-8" />
                )}
                {/* Event type badge, sitting on the avatar's corner. */}
                <span
                  className={cn(
                    "absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full bg-card ring-2 ring-card",
                    kind.tone
                  )}
                >
                  <kind.icon className="size-3.5" />
                </span>
              </span>

              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{actorName}</span> {item.action}{" "}
                <span className="font-medium text-foreground">{item.target}</span>
              </p>

              <time dateTime={item.at.toISOString()} className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {formatDistanceToNowStrict(item.at, { addSuffix: true })}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
