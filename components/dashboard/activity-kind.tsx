import {
  ArrowRightLeftIcon,
  BugIcon,
  CirclePlusIcon,
  CpuIcon,
  GitPullRequestIcon,
  ListTodoIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";

import { AgentAvatar, UserInitial } from "@/components/dashboard/agent-avatar";
import type { ActivityItem, ActivityKind } from "@/lib/activity";
import { cn } from "@/lib/utils";

/** Icon + tone per activity kind. Shared by the Overview, the Activity page and an agent's activity drawer. */
export const ACTIVITY_KIND: Record<ActivityKind, { icon: LucideIcon; tone: string }> = {
  joined: { icon: UserPlusIcon, tone: "text-brand-emphasis" },
  configured: { icon: SlidersHorizontalIcon, tone: "text-action" },
  paused: { icon: PauseIcon, tone: "text-muted-foreground" },
  resumed: { icon: PlayIcon, tone: "text-success" },
  generated: { icon: SparklesIcon, tone: "text-brand-emphasis" },
  scan: { icon: ShieldCheckIcon, tone: "text-success" },
  task_created: { icon: CirclePlusIcon, tone: "text-muted-foreground" },
  task_moved: { icon: ArrowRightLeftIcon, tone: "text-action" },
  task_edited: { icon: PencilIcon, tone: "text-muted-foreground" },
  task_removed: { icon: Trash2Icon, tone: "text-muted-foreground" },
  task_assigned: { icon: ListTodoIcon, tone: "text-warning" },
  task_run: { icon: CpuIcon, tone: "text-action" },
  pull_request: { icon: GitPullRequestIcon, tone: "text-brand-emphasis" },
  issue_filed: { icon: BugIcon, tone: "text-error" },
};

/** The actor's avatar with the event's icon on its corner. */
export function ActivityAvatar({ item }: { item: Pick<ActivityItem, "actor" | "kind"> }) {
  const kind = ACTIVITY_KIND[item.kind] ?? ACTIVITY_KIND.configured;
  return (
    // h-fit: in a stretched flex row the badge would otherwise sink to the row's bottom.
    <span className="relative h-fit shrink-0">
      {item.actor.type === "agent" ? (
        <AgentAvatar agent={item.actor.agent} alt="" className="size-8" />
      ) : (
        <UserInitial name={item.actor.name} className="size-8" />
      )}
      <span
        className={cn(
          "absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full bg-card ring-2 ring-card",
          kind.tone
        )}
      >
        <kind.icon className="size-3.5" />
      </span>
    </span>
  );
}

export function actorName(item: Pick<ActivityItem, "actor">) {
  if (item.actor.type === "agent") return item.actor.agent.name;
  return item.actor.isViewer ? "You" : item.actor.name;
}
