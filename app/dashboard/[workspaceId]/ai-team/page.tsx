import type { Metadata } from "next";

import { AiTeamView } from "@/components/ai-team/ai-team-view";
import { workspaceProvider } from "@/lib/agent-config";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { getAgentTeam, getTeamOverview } from "@/lib/agents";
import { getLatestTrustScans, getSwitchConnection, switchScanProblem } from "@/lib/switch-trust";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "AI Team" };

export default async function AiTeamPage({ params }: PageProps<"/dashboard/[workspaceId]/ai-team">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const [scans, keys, switchConnection] = await Promise.all([
    getLatestTrustScans(workspace.id),
    getAIKeys(workspace.id),
    getSwitchConnection(workspace.id),
  ]);
  const { agents, stats } = await getAgentTeam(workspace, scans);
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
      switchTrust={{ connected: switchConnection !== null, problem: switchScanProblem() }}
    />
  );
}
