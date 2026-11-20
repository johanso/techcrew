import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ChartColumnIcon,
  CircleAlertIcon,
  CircleCheckBigIcon,
  CircleStopIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  RepeatIcon,
  ScrollTextIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { AgentAvatar } from "@/components/dashboard/agent-avatar";
import { dashboardHref } from "@/components/dashboard/nav";
import { PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { SectionEmpty, SurfaceEmpty } from "@/components/dashboard/section-empty";
import { StatTile } from "@/components/dashboard/stat-tile";
import { BarList } from "@/components/metrics/bar-list";
import { buttonVariants } from "@/components/ui/button";
import { AGENT_ROLES, formatMicros } from "@/lib/agent-config";
import type { WorkspaceMetrics } from "@/lib/metrics";
import { METRIC_PERIODS, OUTCOMES, REWORK_CAUSES, formatRate, outcomeOf, type Outcome, type ReworkCause } from "@/lib/run-metrics";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/cli-agents-config";

const OUTCOME_META: Record<Outcome, { label: string; icon: LucideIcon; tone: string }> = {
  merged: { label: "Merged", icon: GitMergeIcon, tone: "text-success" },
  ready: { label: "Ready to merge", icon: GitPullRequestIcon, tone: "text-success" },
  failed: { label: "Agents stopped", icon: CircleAlertIcon, tone: "text-error" },
  stopped: { label: "Stopped by you", icon: CircleStopIcon, tone: "text-muted-foreground" },
  needs_info: { label: "Needed info", icon: MessageCircleQuestionIcon, tone: "text-warning" },
  running: { label: "Running", icon: LoaderCircleIcon, tone: "text-action" },
};

const REWORK_META: Record<ReworkCause, { label: string; icon: LucideIcon }> = {
  ci: { label: "CI failed", icon: ListChecksIcon },
  lead: { label: "Lead sent it back", icon: RepeatIcon },
  tests: { label: "Tests failed", icon: CircleAlertIcon },
};

/** 7 / 30 / 90 days, as links (the page reads `?days=`), styled like the board's segmented filter. */
function PeriodTabs({ workspaceId, days }: { workspaceId: number; days: number }) {
  const href = dashboardHref(workspaceId, "metrics");
  return (
    <nav aria-label="Period" className="flex gap-1 rounded-lg bg-muted p-1 ring-1 ring-border/70">
      {METRIC_PERIODS.map((period) => {
        const current = period === days;
        return (
          <Link
            key={period}
            href={period === 30 ? href : `${href}?days=${period}`}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              current && "bg-card text-foreground ring-1 ring-border"
            )}
          >
            {period} days
          </Link>
        );
      })}
    </nav>
  );
}

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

/** The Metrics page: how the agent pipeline did on the runs started in the period. The page only loads the data. */
export function MetricsView({ workspaceId, metrics }: { workspaceId: number; metrics: WorkspaceMetrics }) {
  const { summary, days } = metrics;
  const header = (
    <PageHeader
      eyebrow="Pipeline"
      title="Metrics"
      description="How the agents deliver: outcomes, rework and what a delivered card costs, for the runs started in the period."
      actions={<PeriodTabs workspaceId={workspaceId} days={days} />}
    />
  );

  if (summary.runs === 0) {
    return (
      <>
        {header}
        <SectionEmpty
          icon={ChartColumnIcon}
          title={`No runs in the last ${days} days`}
          description="Run a card on the board and its outcome, rework and cost show up here."
        >
          <Link href={dashboardHref(workspaceId, "board")} className={buttonVariants({ className: "h-9" })}>
            Open the board
          </Link>
        </SectionEmpty>
      </>
    );
  }

  const finished = summary.delivered + summary.outcomes.failed;
  const reworkTotal = REWORK_CAUSES.reduce((sum, cause) => sum + summary.reworkCauses[cause], 0);
  const agentSpend = metrics.costByAgent.reduce((sum, row) => sum + row.costMicros, 0);

  return (
    <>
      {header}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={CircleCheckBigIcon}
          tone="text-success"
          label="Delivered"
          value={summary.delivered}
          hint={finished ? `${formatRate(summary.successRate)} of ${finished} finished run${finished === 1 ? "" : "s"}` : "No run has finished yet"}
        />
        <StatTile
          icon={RepeatIcon}
          label="First pass"
          value={formatRate(summary.firstPassRate)}
          hint={summary.delivered ? "Delivered without a rework round" : "Nothing delivered yet"}
        />
        <StatTile
          icon={ListChecksIcon}
          tone="text-action"
          label="CI pass rate"
          value={formatRate(summary.ciPassRate)}
          hint={summary.ciDecided ? `${summary.ciDecided} push${summary.ciDecided === 1 ? "" : "es"} checked by CI` : "No CI results in this period"}
        />
        <StatTile
          icon={WalletIcon}
          tone="text-warning"
          label="API cost per delivered card"
          value={summary.costPerDeliveredMicros === null ? "—" : formatMicros(summary.costPerDeliveredMicros)}
          hint={`${formatMicros(summary.totalCostMicros)} API spend in ${days} days, failed runs included${
            summary.planRuns ? ` · runs on your plans: ${summary.planRuns}` : ""
          }`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="surface flex min-w-0 flex-col">
          <SurfaceHeader title="Outcomes" description={`${summary.runs} run${summary.runs === 1 ? "" : "s"} started`} />
          <BarList
            className="p-6"
            items={OUTCOMES.map((outcome) => {
              const meta = OUTCOME_META[outcome];
              const count = summary.outcomes[outcome];
              return {
                key: outcome,
                name: meta.label,
                label: (
                  <>
                    <meta.icon className={cn("size-4 shrink-0", meta.tone)} />
                    <span className="truncate">{meta.label}</span>
                  </>
                ),
                value: count,
                display: `${count} · ${share(count, summary.runs)}`,
              };
            })}
          />
        </section>

        <section className="surface flex min-w-0 flex-col">
          <SurfaceHeader title="Why work went back" description={`${reworkTotal} rework round${reworkTotal === 1 ? "" : "s"}`} />
          {reworkTotal === 0 ? (
            <SurfaceEmpty icon={RepeatIcon} title="No rework" description="Every run in this period went through on the first pass." />
          ) : (
            <BarList
              className="p-6"
              items={REWORK_CAUSES.map((cause) => {
                const meta = REWORK_META[cause];
                const count = summary.reworkCauses[cause];
                return {
                  key: cause,
                  name: meta.label,
                  label: (
                    <>
                      <meta.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{meta.label}</span>
                    </>
                  ),
                  value: count,
                  display: String(count),
                };
              })}
            />
          )}
        </section>

        <section className="surface flex min-w-0 flex-col">
          <SurfaceHeader title="API spend by agent" description={`${formatMicros(agentSpend)} on pipeline work`} />
          {metrics.costByAgent.length === 0 ? (
            <SurfaceEmpty icon={WalletIcon} title="No spend" description="No agent spent on pipeline work in this period." />
          ) : (
            <BarList
              className="p-6"
              items={metrics.costByAgent.map(({ agent, costMicros }) => ({
                key: agent,
                name: AGENT_ROLES[agent].name,
                label: (
                  <>
                    <AgentAvatar agent={AGENT_ROLES[agent]} alt="" className="size-6" />
                    <span className="truncate">{AGENT_ROLES[agent].name}</span>
                  </>
                ),
                value: costMicros,
                display: formatMicros(costMicros),
              }))}
            />
          )}
          {metrics.planByAgent.length > 0 && (
            <p className="mt-auto border-t border-border/70 px-6 py-4 text-xs text-muted-foreground">
              On your plans:{" "}
              {metrics.planByAgent.map(({ agent, tokens }) => `${AGENT_ROLES[agent].name} ${formatTokens(tokens)} tokens`).join(" · ")}
            </p>
          )}
        </section>
      </div>

      <section className="surface flex min-w-0 flex-col">
        <SurfaceHeader title="Recent runs" description="The latest runs in the period, newest first" />
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-xl text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left">
                <th scope="col" className="eyebrow px-6 py-3 font-semibold text-muted-foreground">Card</th>
                <th scope="col" className="eyebrow px-3 py-3 font-semibold text-muted-foreground">Outcome</th>
                <th scope="col" className="eyebrow px-3 py-3 text-right font-semibold text-muted-foreground">Rework</th>
                <th scope="col" className="eyebrow px-3 py-3 text-right font-semibold text-muted-foreground">Cost</th>
                <th scope="col" className="eyebrow px-6 py-3 text-right font-semibold text-muted-foreground">Started</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recent.map((run) => {
                const meta = OUTCOME_META[outcomeOf(run.status)];
                return (
                  <tr key={run.id} className="border-b border-border/70 last:border-b-0">
                    <td className="max-w-80 px-6 py-3">
                      <Link
                        href={`${dashboardHref(workspaceId, "board")}?log=${run.taskId}`}
                        className="group flex min-w-0 items-center gap-2 hover:text-brand-emphasis"
                      >
                        <span className="shrink-0 font-semibold tabular-nums">{run.key}</span>
                        <span className="truncate text-muted-foreground group-hover:text-brand-emphasis">{run.title}</span>
                        <ScrollTextIcon aria-hidden className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        <span className="sr-only">(open the agent log)</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <meta.icon aria-hidden className={cn("size-3.5 shrink-0", meta.tone)} />
                        {meta.label}
                        {run.pullRequest && (
                          <a href={run.pullRequest.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-brand-emphasis hover:underline">
                            #{run.pullRequest.number}
                          </a>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{run.reworkRounds}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMicros(run.costMicros)}</td>
                    <td className="px-6 py-3 text-right whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNowStrict(run.startedAt, { addSuffix: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
