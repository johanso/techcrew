"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRightIcon } from "lucide-react";

import { AgentPortrait, AgentStatusBadge, BudgetMeter } from "@/components/ai-team/agent-visuals";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { useLiveTeam } from "@/components/office/live-team";
import { buttonVariants } from "@/components/ui/button";
import type { TeamMember } from "@/lib/agents";
import { cn } from "@/lib/utils";

function memberLine(member: TeamMember) {
  if (member.currentTask) return member.currentTask;
  return member.lastAction ? `Active ${formatDistanceToNowStrict(member.lastAction.at, { addSuffix: true })}` : "No work yet";
}

/** Overview: the four agents with what they're doing now, plus this month's spend. Live via <LiveTeamProvider>. */
export function TeamStatus({ teamHref, className }: { teamHref: string; className?: string }) {
  const { team } = useLiveTeam();
  const working = team.members.filter((m) => m.status === "working").length;
  return (
    <section className={cn("surface flex min-w-0 flex-col", className)}>
      <SurfaceHeader
        title="AI team"
        description={working ? `${working} of ${team.members.length} agents working` : "Everyone is waiting for work"}
        actions={
          <Link href={teamHref} className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}>
            View team
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        }
      />
      <ul className="flex flex-col">
        {team.members.map((member) => (
          <li key={member.id} className="flex items-center gap-3.5 border-b border-border/70 px-6 py-3.5">
            <AgentPortrait agent={member} status={member.status} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate text-sm font-semibold" title={member.role}>
                {member.name}
              </p>
              <p
                // Relative times can differ by a second between server render and hydration.
                suppressHydrationWarning
                className={cn("truncate text-xs", member.currentTask ? "font-medium text-foreground" : "text-muted-foreground")}
              >
                {memberLine(member)}
              </p>
            </div>
            <AgentStatusBadge status={member.status} />
          </li>
        ))}
      </ul>
      <BudgetMeter
        spentMicros={team.monthSpendMicros}
        budgetCents={team.monthBudgetCents}
        label="team budget this month"
        className="mt-auto px-6 py-4"
      />
    </section>
  );
}
