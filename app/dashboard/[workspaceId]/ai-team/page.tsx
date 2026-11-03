import type { Metadata } from "next";

import { AiTeamView } from "@/components/ai-team/ai-team-view";
import { getAgentTeam } from "@/lib/agents";
import { isOpenAIConfigured } from "@/lib/openai";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "AI Team" };

export default async function AiTeamPage({ params }: PageProps<"/dashboard/[workspaceId]/ai-team">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const { agents, stats } = await getAgentTeam(workspace);

  return (
    <AiTeamView
      workspace={{ id: workspace.id, githubRepoFullName: workspace.githubRepoFullName }}
      agents={agents}
      stats={stats}
      aiEnabled={isOpenAIConfigured()}
    />
  );
}
