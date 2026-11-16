import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { BugIcon, CalendarIcon, CalendarX2Icon, CircleDotIcon, SparklesIcon, type LucideIcon } from "lucide-react";

import type { BoardColumnId, IssuePriority, IssueType } from "@/lib/board-config";
import { cn } from "@/lib/utils";

/**
 * Visual vocabulary for issues: type, priority and column colors. Shared by the board, the
 * create dialog and the Overview so the same thing always looks the same.
 *
 * Status colors appear on icons, dots and tints only — labels stay neutral text, because the
 * palette's status colors fail WCAG AA as small text on light surfaces.
 */

export const ISSUE_TYPE_META: Record<IssueType, { label: string; icon: LucideIcon; tone: string; blurb: string }> = {
  feature: { label: "Feature", icon: SparklesIcon, tone: "text-brand-emphasis", blurb: "New functionality" },
  bug: { label: "Bug", icon: BugIcon, tone: "text-error", blurb: "Something is broken" },
  issue: { label: "Issue", icon: CircleDotIcon, tone: "text-action", blurb: "Task or improvement" },
};

export const PRIORITY_META: Record<IssuePriority, { label: string; dot: string }> = {
  urgent: { label: "Urgent", dot: "bg-error ring-3 ring-error/20" },
  high: { label: "High", dot: "bg-warning" },
  medium: { label: "Medium", dot: "bg-brand-accent" },
  low: { label: "Low", dot: "bg-dark" },
};

/** Light tint per column: background, hairline ring, and the header dot. */
export const COLUMN_STYLE: Record<BoardColumnId, { tint: string; ring: string; dot: string; over: string }> = {
  todo: { tint: "bg-dark/7", ring: "ring-dark/15", dot: "bg-dark", over: "ring-dark/45" },
  analysis: { tint: "bg-brand/6", ring: "ring-brand/15", dot: "bg-brand", over: "ring-brand/45" },
  in_development: { tint: "bg-action/7", ring: "ring-action/20", dot: "bg-action", over: "ring-action/60" },
  in_review: { tint: "bg-brand-accent/10", ring: "ring-brand-accent/30", dot: "bg-brand-accent", over: "ring-brand-accent/70" },
  testing: { tint: "bg-warning/7", ring: "ring-warning/20", dot: "bg-warning", over: "ring-warning/60" },
  done: { tint: "bg-success/8", ring: "ring-success/25", dot: "bg-success", over: "ring-success/60" },
};

export function PriorityBadge({ priority, className }: { priority: IssuePriority; className?: string }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function IssueTypePill({ type, className }: { type: IssueType; className?: string }) {
  const meta = ISSUE_TYPE_META[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground ring-1 ring-border/70",
        className
      )}
    >
      <meta.icon className={cn("size-3", meta.tone)} />
      {meta.label}
    </span>
  );
}

/** Due date chip: "Today", "Tomorrow" or "MMM d"; overdue (unless done) in the error color with its own icon. */
export function DueDate({ date, done = false, className }: { date: string; done?: boolean; className?: string }) {
  const days = differenceInCalendarDays(parseISO(date), new Date());
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : format(parseISO(date), "MMM d");
  const overdue = days < 0 && !done;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        overdue ? "font-semibold text-error" : days <= 1 && !done && "font-semibold text-foreground",
        className
      )}
      title={overdue ? `Overdue since ${format(parseISO(date), "MMM d")}` : "Due date"}
    >
      {overdue ? <CalendarX2Icon className="size-3.5" /> : <CalendarIcon className="size-3.5" />}
      {overdue && <span className="sr-only">Overdue:</span>}
      {label}
    </span>
  );
}
