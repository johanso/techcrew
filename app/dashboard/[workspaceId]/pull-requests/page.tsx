import type { Metadata } from "next";
import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";
import { buttonVariants } from "@/components/ui/button";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Pull Requests" };

export default async function PullRequestsPage({ params }: PageProps<"/dashboard/[workspaceId]/pull-requests">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);

  return (
    <>
      <PageHeader title="Pull Requests" description="Changes your agents propose, ready for review." />
      <SectionEmpty
        icon={GitPullRequestIcon}
        title="No agent pull requests yet"
        description="When an agent finishes a task, its pull request will appear here for review."
      >
        <a
          href={`${workspace.githubRepoUrl}/pulls`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", className: "h-9" })}
        >
          View pull requests on GitHub
          <ExternalLinkIcon data-icon="inline-end" />
        </a>
      </SectionEmpty>
    </>
  );
}
