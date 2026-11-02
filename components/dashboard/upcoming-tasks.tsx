import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import {
  ArrowRightIcon,
  CircleDotDashedIcon,
  CircleIcon,
  GitPullRequestArrowIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { AgentAvatar } from "@/components/dashboard/agent-avatar";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import type { TaskPriority, TaskStatus, UpcomingTask } from "@/lib/overview";
import { cn } from "@/lib/utils";

export const TASK_STATUS: Record<TaskStatus, { label: string; icon: LucideIcon; tone: string }> = {
  open: { label: "Open", icon: CircleIcon, tone: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: CircleDotDashedIcon, tone: "text-warning" },
  pr_ready: { label: "PR ready", icon: GitPullRequestArrowIcon, tone: "text-success" },
};

// Status colors stay on the dot; the label is neutral text (palette status colors fail AA as small text).
const PRIORITY: Record<TaskPriority, { label: string; dot: string }> = {
  high: { label: "High", dot: "bg-error" },
  medium: { label: "Medium", dot: "bg-warning" },
  low: { label: "Low", dot: "bg-dark" },
};

function dueLabel(date: Date) {
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

export function UpcomingTasks({
  tasks,
  boardHref,
  className,
}: {
  tasks: UpcomingTask[];
  boardHref: string;
  className?: string;
}) {
  return (
    <section className={cn("surface flex min-w-0 flex-col", className)}>
      <SurfaceHeader
        title="Upcoming tasks"
        description="What your AI team is working on next"
        actions={
          <Link href={boardHref} className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}>
            View board
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        }
      />
      <ul className="flex flex-col">
        {tasks.map((task) => {
          const status = TASK_STATUS[task.status];
          const priority = PRIORITY[task.priority];
          const dueSoon = isToday(task.dueAt);
          return (
            <li
              key={task.id}
              className="flex items-center gap-4 border-b border-border/70 px-6 py-4 transition-colors last:border-b-0 hover:bg-accent/50"
            >
              <span className={cn("shrink-0", status.tone)} title={status.label}>
                <status.icon className="size-5" />
                <span className="sr-only">{status.label}</span>
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="truncate text-sm font-semibold">{task.title}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium tabular-nums">{task.key}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn("size-1.5 rounded-full", priority.dot)} />
                    {priority.label}
                  </span>
                  {task.labels.map((label) => (
                    <span key={label} className="rounded-md bg-muted px-1.5 py-0.5 font-medium ring-1 ring-border/70">
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    "hidden text-xs whitespace-nowrap sm:inline",
                    dueSoon ? "font-semibold text-foreground" : "text-muted-foreground"
                  )}
                >
                  {dueLabel(task.dueAt)}
                </span>
                {task.assignee ? (
                  <AgentAvatar agent={task.assignee} />
                ) : (
                  <span
                    title="Unassigned"
                    className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border"
                  >
                    <UserRoundIcon className="size-3.5" />
                    <span className="sr-only">Unassigned</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
