import Link from "next/link";
import { BotIcon, CoinsIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";

import { AgentRoster } from "@/components/ai-team/agent-roster";
import { AGENT_STATUS, AgentPortrait } from "@/components/ai-team/agent-visuals";
import { AgentOfficePlaceholder } from "@/components/dashboard/agent-office-placeholder";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { MICROS_PER_USD, formatCents, formatMicros, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import { trustGrade } from "@/lib/agent-trust";
import type { AgentTeamStats, AgentView } from "@/lib/agents";
import { cn } from "@/lib/utils";

/** AI Team content. Presentational: the page loads the data. */
export function AiTeamView({
  workspace,
  agents,
  stats,
  aiEnabled,
  providers,
  provider,
}: {
  workspace: { id: number; githubRepoFullName: string };
  agents: AgentView[];
  stats: AgentTeamStats;
  aiEnabled: boolean;
  providers: ProviderStatus;
  provider: AgentProvider;
}) {
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
          label="Skill Trust Score"
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
            grade && stats.lowestTrust
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

      <AgentRoster
        agents={agents}
        workspaceId={workspace.id}
        repoFullName={workspace.githubRepoFullName}
        aiEnabled={aiEnabled}
        providers={providers}
        provider={provider}
      />

      <AgentOfficePlaceholder title="Live Agent Office Workspace" description="Watch your agents work in real time" className="min-h-96">
        {/* Empty desks waiting for the live view. */}
        <ul className="relative mb-4 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Agent desks">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="flex flex-col items-center gap-2 rounded-xl bg-card/80 px-3 py-4 ring-1 ring-border/70"
            >
              <AgentPortrait agent={agent} status={agent.status} />
              <span className="text-xs font-semibold">{agent.name}</span>
              <span className={cn("text-[11px] text-muted-foreground")}>{AGENT_STATUS[agent.status].hint}</span>
            </li>
          ))}
        </ul>
      </AgentOfficePlaceholder>
    </>
  );
}
