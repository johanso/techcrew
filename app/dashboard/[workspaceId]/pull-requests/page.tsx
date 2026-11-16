import type { Metadata } from "next";

import { PullRequestsView } from "@/components/pull-requests/pull-requests-view";
import { listPullRequests, refreshOpenPullRequests } from "@/lib/pull-requests";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Pull Requests" };

export default async function PullRequestsPage({ params }: PageProps<"/dashboard/[workspaceId]/pull-requests">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  // Merges and closes done directly on GitHub show up here (and move their cards) on the next visit.
  await refreshOpenPullRequests(workspace);
  const pullRequests = await listPullRequests(workspace);

  return (
    <PullRequestsView
      workspace={{ id: workspace.id, repoUrl: workspace.githubRepoUrl, autoMerge: workspace.agentAutoMerge }}
      pullRequests={pullRequests}
    />
  );
}
