import type { Metadata } from "next";
import { BotIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "AI Team" };

export default async function AiTeamPage({ params }: PageProps<"/dashboard/[workspaceId]/ai-team">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);

  return (
    <>
      <PageHeader title="AI Team" description="The agents that work on this workspace's repository." />
      <SectionEmpty
        icon={BotIcon}
        title="No agents yet"
        description={`Agents you add will read, change and open pull requests on ${workspace.githubRepoFullName}.`}
      />
    </>
  );
}
