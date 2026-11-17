import { ActivityIcon, BlocksIcon, CpuIcon, LibraryBigIcon, ListTodoIcon, SlidersHorizontalIcon } from "lucide-react";

import { AgentPortrait, AgentStatusBadge, BudgetMeter, TrustChip } from "@/components/ai-team/agent-visuals";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_MODELS } from "@/lib/agent-config";
import type { AgentView, TeamMember } from "@/lib/agents";
import { isPendingScan } from "@/lib/switch-trust-config";
import { cn } from "@/lib/utils";

/** "Working…" dots: each fades in turn (static under reduced motion). */
function WorkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="working-dot size-1 rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/**
 * One agent on the AI Team page: identity, status, what it's set up with, budget use and its two actions. `live` is
 * the polled status (LiveTeamProvider): while the agent works, the card says on which card and what it's doing.
 */
export function AgentCard({
  agent,
  live,
  onConfigure,
  onViewActivity,
}: {
  agent: AgentView;
  live: TeamMember | null;
  onConfigure: () => void;
  onViewActivity: () => void;
}) {
  const model = AGENT_MODELS.find((m) => m.id === agent.model);
  const status = live?.status ?? agent.status;
  const working = status === "working";

  return (
    <article
      className={cn("surface flex min-w-0 flex-col transition-colors", working && "border-brand/45")}
      aria-labelledby={`agent-${agent.id}-name`}
    >
      <div className="flex flex-1 flex-col gap-5 p-5">
        {/* Name and specialty sit beside the face to save a row; the specialty may wrap to two lines on narrow cards. */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <AgentPortrait agent={agent} status={status} working={working} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 id={`agent-${agent.id}-name`} className="truncate text-base font-bold">
                {agent.name}
              </h3>
              <p className="line-clamp-2 text-xs font-medium text-muted-foreground">{agent.role}</p>
            </div>
            <AgentStatusBadge status={status} className="self-start" />
          </div>
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{agent.description}</p>
        </div>

        {working && live?.task && (
          <div className="flex flex-col gap-1 rounded-lg bg-brand/5 px-3 py-2.5 ring-1 ring-brand/20">
            <p className="flex items-center gap-1.5 text-xs font-bold text-brand-emphasis">
              Working on {live.task.key}
              <WorkingDots />
            </p>
            <p className="line-clamp-2 text-sm">{live.doing ?? live.currentTask}</p>
          </div>
        )}

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Setup">
          <li className="flex items-center gap-1.5" title="Model">
            <CpuIcon className="size-3.5" />
            <span className="font-medium text-foreground">{model?.label ?? agent.model}</span>
          </li>
          <li className="flex items-center gap-1.5" title="What the agent may do">
            <BlocksIcon className="size-3.5" />
            <span>
              Permissions · <span className="font-medium text-foreground tabular-nums">{agent.permissions.length}</span>
            </span>
          </li>
          <li className="flex items-center gap-1.5" title="Knowledge the agent reads while it works">
            <LibraryBigIcon className="size-3.5" />
            <span>
              Skills · <span className="font-medium text-foreground tabular-nums">{agent.skillIds.length}</span>
            </span>
          </li>
          <li>
            {agent.scan && isPendingScan(agent.scan.status) ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-emphasis" role="status">
                <Spinner className="size-3" />
                Scanning…
              </span>
            ) : (
              <TrustChip score={agent.trust?.score ?? null} />
            )}
          </li>
          {agent.openTasks > 0 && (
            <li className="flex items-center gap-1.5" title="Assigned cards not done yet">
              <ListTodoIcon className="size-3.5" />
              <span>
                <span className="font-medium text-foreground tabular-nums">{agent.openTasks}</span> open card
                {agent.openTasks === 1 ? "" : "s"}
              </span>
            </li>
          )}
        </ul>

        <div className="mt-auto flex flex-col gap-2 rounded-lg bg-muted/50 p-3 ring-1 ring-border/60">
          <p className="eyebrow text-muted-foreground">Monthly budget</p>
          <BudgetMeter spentMicros={agent.spend.monthMicros} budgetCents={agent.monthlyBudgetCents} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/70 p-3">
        <Button variant="outline" className="h-9" onClick={onConfigure}>
          <SlidersHorizontalIcon data-icon="inline-start" />
          Configure
        </Button>
        <Button variant="ghost" className="h-9" onClick={onViewActivity}>
          <ActivityIcon data-icon="inline-start" />
          View activity
        </Button>
      </div>
    </article>
  );
}
