import Link from "next/link";
import { BotIcon, CoinsIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";

import { AgentRoster } from "@/components/ai-team/agent-roster";
import { LiveProcess } from "@/components/ai-team/live-process";
import { LiveTeamProvider } from "@/components/ai-team/live-team";
import { TrustScanWatcher } from "@/components/ai-team/trust-scan-watcher";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { MICROS_PER_USD, formatCents, formatMicros, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import { trustGrade } from "@/lib/agent-trust";
import type { AgentTeamStats, AgentView, TeamOverview } from "@/lib/agents";
import { isPendingScan, type SwitchTrustStatus } from "@/lib/switch-trust-config";

/** AI Team content. Presentational: the page loads the data. */
export function AiTeamView({
  workspace,
  agents,
  team,
  stats,
  aiEnabled,
  providers,
  provider,
  switchTrust,
}: {
  workspace: { id: number; githubRepoFullName: string };
  agents: AgentView[];
  /** Live status for the cards and the live process (polled on the client). */
  team: TeamOverview;
  stats: AgentTeamStats;
  aiEnabled: boolean;
  providers: ProviderStatus;
  provider: AgentProvider;
  switchTrust: SwitchTrustStatus;
}) {
  const scanning = agents.filter((a) => a.scan && isPendingScan(a.scan.status)).length;
  const budgetMicros = stats.monthBudgetCents * (MICROS_PER_USD / 100);
  const usedPercent = budgetMicros > 0 ? (stats.monthSpendMicros / budgetMicros) * 100 : 0;
  const paused = stats.total - stats.active;
  const grade = stats.trustAverage !== null ? trustGrade(stats.trustAverage) : null;

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="AI Team"
        description={`Your agents work on ${workspace.githubRepoFullName}. Configure what each one does, what it may touch and how much it can spend.`}
        actions={
          !aiEnabled && (
            <Link
              href={`/dashboard/${workspace.id}/settings#ai`}
              className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground hover:ring-brand/30"
              title="Add an API key to run agents, draft instructions with AI and get AI-assisted trust scans"
            >
              <SparklesIcon className="size-3.5" />
              No AI provider connected · Add a key
            </Link>
          )
        }
      />

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Team summary">
        <StatTile
          icon={BotIcon}
          label="Active agents"
          value={
            <>
              {stats.active}
              <span className="text-lg font-semibold text-muted-foreground">/{stats.total}</span>
            </>
          }
          hint={
            stats.working
              ? `${stats.working} working on cards${paused ? ` · ${paused} paused` : ""}`
              : paused
                ? `${paused} paused`
                : "All ready for work"
          }
          tone="text-brand-emphasis"
        />
        <StatTile
          icon={ShieldCheckIcon}
          label={switchTrust.connected ? "Switch Trust Score" : "Skill Trust Score"}
          value={
            stats.trustAverage === null ? (
              "—"
            ) : (
              <>
                {stats.trustAverage}
                <span className="text-lg font-semibold text-muted-foreground">/100</span>
              </>
            )
          }
          hint={
            scanning
              ? `SwitchAgent is scanning ${scanning} agent${scanning === 1 ? "" : "s"}…`
              : grade && stats.lowestTrust
                ? `${grade.label} · lowest: ${stats.lowestTrust.name} ${stats.lowestTrust.score}`
                : "Scan an agent to get a score"
          }
          tone={grade?.tone ?? "text-success"}
        />
        <StatTile
          icon={CoinsIcon}
          label="Monthly spending"
          value={formatMicros(stats.monthSpendMicros)}
          hint={`of ${formatCents(stats.monthBudgetCents)} budget · ${usedPercent > 0 && usedPercent < 1 ? "<1" : Math.round(usedPercent)}% used`}
          tone={usedPercent >= 100 ? "text-error" : usedPercent >= 75 ? "text-warning" : "text-action"}
        />
      </section>

      <LiveTeamProvider workspaceId={workspace.id} initial={team}>
        <AgentRoster
          agents={agents}
          workspaceId={workspace.id}
          repoFullName={workspace.githubRepoFullName}
          aiEnabled={aiEnabled}
          providers={providers}
          provider={provider}
          switchTrust={switchTrust}
        />
        <LiveProcess workspaceId={workspace.id} />
      </LiveTeamProvider>
      <TrustScanWatcher pending={scanning > 0} />
    </>
  );
}
