import Link from "next/link";
import {
  ArrowRightIcon,
  CircleDotDashedIcon,
  CircleIcon,
  GitPullRequestArrowIcon,
  ListTodoIcon,
  type LucideIcon,
} from "lucide-react";

import { runStatusMeta } from "@/components/board/agent-run-status";
import { COLUMN_STYLE, DueDate, IssueTypePill, PriorityBadge } from "@/components/board/issue-meta";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { buttonVariants } from "@/components/ui/button";
import { BOARD_COLUMNS } from "@/lib/board-config";
import type { TaskStatus, UpcomingTask } from "@/lib/overview";
import { cn } from "@/lib/utils";

export const TASK_STATUS: Record<TaskStatus, { label: string; icon: LucideIcon; tone: string }> = {
  open: { label: "Open", icon: CircleIcon, tone: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: CircleDotDashedIcon, tone: "text-warning" },
  pr_ready: { label: "PR ready", icon: GitPullRequestArrowIcon, tone: "text-success" },
};

/** Where the card is: its agent run while one is going on (or stopped), else its board column. */
function TaskProgress({ task }: { task: UpcomingTask }) {
  if (task.run && task.run.status !== "completed") {
    const meta = runStatusMeta(task.run);
    return (
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <meta.icon aria-hidden className={cn("size-3.5 shrink-0", meta.tone, meta.spin && "animate-spin")} />
        <span className="truncate">{meta.label}</span>
      </span>
    );
  }
  const column = BOARD_COLUMNS.find((c) => c.id === task.column)!;
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-medium">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", COLUMN_STYLE[task.column].dot)} />
      <span className="truncate">{column.title}</span>
    </span>
  );
}

function TaskDue({ task }: { task: UpcomingTask }) {
  return task.dueDate ? <DueDate date={task.dueDate} /> : <span className="text-muted-foreground">No due date</span>;
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
      {tasks.length === 0 ? (
        <SurfaceEmpty
          icon={ListTodoIcon}
          title="No open tasks"
          description="Add a card on the board, or open an issue on the linked GitHub repository. Open cards show up here."
        />
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => {
            const status = TASK_STATUS[task.status];
            return (
              <li
                key={task.id}
                className="flex items-start gap-4 border-b border-border/70 px-6 py-4 transition-colors last:border-b-0 hover:bg-accent/50"
              >
                <span className={cn("mt-0.5 shrink-0", status.tone)} title={status.label}>
                  <status.icon className="size-5" />
                  <span className="sr-only">{status.label}</span>
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="truncate text-sm font-semibold">{task.title}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">{task.key}</span>
                    <IssueTypePill type={task.type} />
                    <PriorityBadge priority={task.priority} />
                    {task.githubIssueNumber !== null && <span className="tabular-nums">#{task.githubIssueNumber}</span>}
                    {task.labels[0] && (
                      <span className="max-w-28 truncate rounded-md bg-muted px-1.5 py-0.5 font-medium ring-1 ring-border/70">
                        {task.labels[0]}
                      </span>
                    )}
                    {task.labels.length > 1 && (
                      <span className="tabular-nums" title={task.labels.slice(1).join(", ")}>
                        +{task.labels.length - 1}
                      </span>
                    )}
                  </div>
                  {/* On phones the progress column below moves under the meta row. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:hidden">
                    <TaskProgress task={task} />
                    <TaskDue task={task} />
                  </div>
                </div>

                <div className="hidden w-36 shrink-0 flex-col items-end gap-1.5 text-xs sm:flex">
                  <TaskProgress task={task} />
                  <TaskDue task={task} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
