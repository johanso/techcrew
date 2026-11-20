"use client";

import { useState } from "react";

import { AgentActivitySheet } from "@/components/ai-team/agent-activity-sheet";
import { AgentCard } from "@/components/ai-team/agent-card";
import { AgentConfigDialog } from "@/components/ai-team/agent-config-dialog";
import { useLiveTeam } from "@/components/ai-team/live-team";
import type { AgentKey, AgentProvider, ProviderStatus } from "@/lib/agent-config";
import type { AgentView } from "@/lib/agents";
import type { SkillView } from "@/lib/agent-skills-config";
import type { SwitchTrustStatus } from "@/lib/switch-trust-config";
import type { AgentRoutes } from "@/lib/cli-agents-config";

/**
 * The agent cards plus the configure dialog and activity drawer they open. Both overlays read the agent from
 * `agents`, so after a server action re-renders the page they show fresh data (score, spend, activity).
 */
export function AgentRoster({
  agents,
  workspaceId,
  repoFullName,
  aiEnabled,
  providers,
  plans,
  switchTrust,
  skills,
  routes,
}: {
  agents: AgentView[];
  workspaceId: number;
  repoFullName: string;
  aiEnabled: boolean;
  providers: ProviderStatus;
  /** Companies this computer can run on the owner's plan without an API key ("Your plan" in the model picker). */
  plans: Partial<Record<AgentProvider, boolean>>;
  switchTrust: SwitchTrustStatus;
  /** The workspace's skill library (Settings → Agent skills). */
  skills: SkillView[];
  /** Each agent's route on this computer; null when TechTeam isn't running locally. */
  routes: AgentRoutes | null;
}) {
  const [configuring, setConfiguring] = useState<AgentKey | null>(null);
  const [viewing, setViewing] = useState<AgentKey | null>(null);
  // Keep the last agent while the overlay animates out, so it doesn't go blank mid-transition.
  const [lastConfigured, setLastConfigured] = useState<AgentKey | null>(null);
  const [lastViewed, setLastViewed] = useState<AgentKey | null>(null);

  const { team } = useLiveTeam();

  const configAgent = agents.find((a) => a.id === (configuring ?? lastConfigured));
  const activityAgent = agents.find((a) => a.id === (viewing ?? lastViewed));

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Agents">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            route={routes ? (routes[agent.id] ?? null) : undefined}
            live={team.members.find((m) => m.id === agent.id) ?? null}
            onConfigure={() => {
              setConfiguring(agent.id);
              setLastConfigured(agent.id);
            }}
            onViewActivity={() => {
              setViewing(agent.id);
              setLastViewed(agent.id);
            }}
          />
        ))}
      </section>

      {configAgent && (
        <AgentConfigDialog
          // Remount per agent so the form starts from that agent's saved configuration.
          key={configAgent.id}
          open={configuring !== null}
          onOpenChange={(open) => !open && setConfiguring(null)}
          agent={configAgent}
          workspaceId={workspaceId}
          repoFullName={repoFullName}
          aiEnabled={aiEnabled}
          providers={providers}
          plans={plans}
          switchTrust={switchTrust}
          skills={skills}
        />
      )}
      {activityAgent && (
        <AgentActivitySheet
          open={viewing !== null}
          onOpenChange={(open) => !open && setViewing(null)}
          agent={activityAgent}
        />
      )}
    </>
  );
}
