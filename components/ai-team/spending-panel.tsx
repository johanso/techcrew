import { CoinsIcon } from "lucide-react";

import { BudgetMeter } from "@/components/ai-team/agent-visuals";
import { MICROS_PER_USD, formatCents, formatMicros } from "@/lib/agent-config";
import type { AgentView, SpendCategory } from "@/lib/agents";
import { cn } from "@/lib/utils";

const CATEGORIES: { id: SpendCategory; label: string; tone: string }[] = [
  { id: "tasks", label: "Task runs", tone: "bg-brand-emphasis" },
  { id: "configuration", label: "AI drafting", tone: "bg-action" },
  { id: "scans", label: "Trust scans", tone: "bg-success" },
];

// Budgets reset at 00:00 UTC on the 1st; format in UTC so the date doesn't shift with the viewer's time zone.
const utcLabel = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

/** This month's spend for the configure dialog. `budgetCents` is the dialog's draft, so edits preview live. */
export function SpendingPanel({ spend, budgetCents }: { spend: AgentView["spend"]; budgetCents: number }) {
  const budgetMicros = budgetCents * (MICROS_PER_USD / 100);
  const remaining = Math.max(0, budgetMicros - spend.monthMicros);
  const resetsAt = new Date(spend.resetsAt);
  const projectedOver = spend.projectedMicros > budgetMicros;

  return (
    <section className="surface flex flex-col" aria-labelledby="spend-title">
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3.5">
        <CoinsIcon className="size-4 text-brand-emphasis" />
        <h3 id="spend-title" className="text-sm font-bold">
          Spending
        </h3>
        <span className="ml-auto text-xs text-muted-foreground">{utcLabel(new Date(resetsAt.getTime() - 1), { month: "long" })}</span>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-0.5">
          <p className="text-xl font-bold tracking-tight tabular-nums">{formatMicros(spend.monthMicros)}</p>
          <p className="text-xs text-muted-foreground">spent this month</p>
        </div>

        <BudgetMeter spentMicros={spend.monthMicros} budgetCents={budgetCents} label="budget" />

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="font-semibold tabular-nums">{formatMicros(remaining)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Projected</dt>
            <dd className={cn("font-semibold tabular-nums", projectedOver && "text-error")}>
              {formatMicros(spend.projectedMicros)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Monthly budget</dt>
            <dd className="font-semibold tabular-nums">{formatCents(budgetCents)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Resets</dt>
            <dd className="font-semibold">{utcLabel(resetsAt, { month: "short", day: "numeric" })}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2.5 border-t border-border/70 pt-4">
          <p className="eyebrow text-muted-foreground">Breakdown</p>
          <ul className="flex flex-col gap-2.5">
            {CATEGORIES.map(({ id, label, tone }) => {
              const value = spend.byCategory[id];
              const share = spend.monthMicros > 0 ? (value / spend.monthMicros) * 100 : 0;
              return (
                <li key={id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className={cn("size-2 rounded-full", tone)} />
                      {label}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMicros(value)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className={cn("h-full rounded-full", tone)} style={{ width: `${value > 0 ? Math.max(share, 2) : 0}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Task runs are billed here once the agent runtime starts working on cards.
          </p>
        </div>
      </div>
    </section>
  );
}
