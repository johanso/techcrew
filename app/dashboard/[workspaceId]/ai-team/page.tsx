import type { Metadata } from "next";
import { after } from "next/server";

import { AiTeamView } from "@/components/ai-team/ai-team-view";
import { agentRoutesHere, planProvidersHere } from "@/lib/agent-pipeline";
import { getSkillLibrary } from "@/lib/agent-skills";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { getAgentTeam, getTeamOverview } from "@/lib/agents";
import { getModelCatalog, refreshModelCatalogIfStale } from "@/lib/model-catalog";
import { pickerCatalog } from "@/lib/model-catalog-config";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "AI Team" };

export default async function AiTeamPage({ params }: PageProps<"/dashboard/[workspaceId]/ai-team">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const keys = await getAIKeys(workspace.id);
  const { agents, stats } = await getAgentTeam(workspace);
  // After getAgentTeam, which creates missing agents and built-in skills: both then show their real rows.
  const [team, skills, routes, plans, catalog] = await Promise.all([
    getTeamOverview(workspace),
    getSkillLibrary(workspace.id),
    agentRoutesHere(workspace),
    planProvidersHere(workspace),
    getModelCatalog(),
  ]);
  const providers = keyStatus(keys);
  // A catalog older than a day is fetched again after the response: the next visit shows the new models.
  after(refreshModelCatalogIfStale);

  return (
    <AiTeamView
      workspace={{ id: workspace.id, githubRepoFullName: workspace.githubRepoFullName }}
      agents={agents}
      team={team}
      stats={stats}
      aiEnabled={providers.openai || providers.anthropic}
      providers={providers}
      plans={plans}
      catalog={pickerCatalog(catalog, agents.map((agent) => agent.model))}
      skills={skills}
      routes={routes}
    />
  );
}
