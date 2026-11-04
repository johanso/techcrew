import type { Metadata } from "next";

import { AiTeamView } from "@/components/ai-team/ai-team-view";
import { workspaceProvider } from "@/lib/agent-config";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { getAgentTeam, getTeamOverview } from "@/lib/agents";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "AI Team" };

export default async function AiTeamPage({ params }: PageProps<"/dashboard/[workspaceId]/ai-team">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const [{ agents, stats }, keys] = await Promise.all([getAgentTeam(workspace), getAIKeys(workspace.id)]);
  // After getAgentTeam, which creates missing agents: the office then shows their real rows.
  const team = await getTeamOverview(workspace);
  const providers = keyStatus(keys);

  return (
    <AiTeamView
      workspace={{ id: workspace.id, githubRepoFullName: workspace.githubRepoFullName }}
      agents={agents}
      team={team}
      stats={stats}
      aiEnabled={providers.openai || providers.anthropic}
      providers={providers}
      provider={workspaceProvider(workspace)}
    />
  );
}
