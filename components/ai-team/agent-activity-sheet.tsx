"use client";

import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import {
  BugIcon,
  CpuIcon,
  GitPullRequestIcon,
  HistoryIcon,
  ListTodoIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";

import { AgentPortrait } from "@/components/ai-team/agent-visuals";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatMicros } from "@/lib/agent-config";
import type { AgentActivityKind, AgentActivityView, AgentView } from "@/lib/agents";
import { cn } from "@/lib/utils";

const KIND: Record<AgentActivityKind, { icon: LucideIcon; tone: string }> = {
  joined: { icon: UserPlusIcon, tone: "text-brand-emphasis" },
  configured: { icon: SlidersHorizontalIcon, tone: "text-action" },
  paused: { icon: PauseIcon, tone: "text-muted-foreground" },
  resumed: { icon: PlayIcon, tone: "text-success" },
  generated: { icon: SparklesIcon, tone: "text-brand-emphasis" },
  scan: { icon: ShieldCheckIcon, tone: "text-success" },
  task_assigned: { icon: ListTodoIcon, tone: "text-warning" },
  task_run: { icon: CpuIcon, tone: "text-action" },
  pull_request: { icon: GitPullRequestIcon, tone: "text-brand-emphasis" },
  issue_filed: { icon: BugIcon, tone: "text-error" },
};

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/** Activity grouped by calendar day, newest first (the server already sorts). */
function groupByDay(items: AgentActivityView[]) {
  const groups: { label: string; items: AgentActivityView[] }[] = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.at));
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function AgentActivitySheet({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentView;
}) {
  const monthStart = new Date(agent.spend.resetsAt);
  monthStart.setUTCMonth(monthStart.getUTCMonth() - 1);
  const eventsThisMonth = agent.activity.filter((a) => new Date(a.at) >= monthStart).length;

  const summary = [
    { label: "Events this month", value: eventsThisMonth },
    { label: "Spent this month", value: formatMicros(agent.spend.monthMicros) },
    { label: "Open cards", value: agent.openTasks },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4 pr-12">
          <AgentPortrait agent={agent} status={agent.status} />
          <div className="flex min-w-0 flex-col">
            <SheetTitle className="truncate text-base font-bold">{agent.name} activity</SheetTitle>
            <SheetDescription className="truncate text-xs">
              {agent.role} · latest {agent.activity.length} events
            </SheetDescription>
          </div>
        </div>

        <dl className="grid grid-cols-3 border-b border-border/70 bg-canvas">
          {summary.map(({ label, value }) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 border-r border-border/70 px-4 py-3 last:border-r-0">
              <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
              <dd className="truncate text-base font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {agent.activity.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="icon-tile text-brand-emphasis">
                <HistoryIcon />
              </span>
              <p className="text-sm font-semibold">No activity yet</p>
              <p className="max-w-60 text-xs text-muted-foreground">
                Configuration changes, trust scans and cards you run will show up here.
              </p>
            </div>
          ) : (
            groupByDay(agent.activity).map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3 className="eyebrow sticky top-0 z-10 border-b border-border/70 bg-popover/95 px-5 py-2 text-muted-foreground backdrop-blur-sm">
                  {group.label}
                </h3>
                <ol className="flex flex-col px-5">
                  {group.items.map((item, index) => {
                    const kind = KIND[item.kind] ?? KIND.configured;
                    const at = new Date(item.at);
                    return (
                      <li key={item.id} className="relative flex gap-3 py-3.5">
                        {/* Timeline rail between consecutive events. */}
                        {index < group.items.length - 1 && (
                          <span aria-hidden className="absolute top-12 bottom-0 left-4 w-px bg-border" />
                        )}
                        <span className={cn("icon-tile size-8 rounded-full [&_svg]:size-4", kind.tone)}>
                          <kind.icon aria-hidden />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-semibold">{item.title}</p>
                            <time
                              dateTime={item.at}
                              title={format(at, "PPpp")}
                              className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
                            >
                              {formatDistanceToNowStrict(at, { addSuffix: true })}
                            </time>
                          </div>
                          {item.detail && <p className="line-clamp-3 text-xs text-muted-foreground">{item.detail}</p>}
                          {item.costMicros > 0 && (
                            <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/70">
                              {formatMicros(item.costMicros)}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
