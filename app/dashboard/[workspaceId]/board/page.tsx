import type { Metadata } from "next";
import { SquareKanbanIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params }: PageProps<"/dashboard/[workspaceId]/board">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);

  return (
    <>
      <PageHeader eyebrow="Plan" title="Board" description="Plan and track the work your AI team takes on." />
      <SectionEmpty
        icon={SquareKanbanIcon}
        title="No tasks yet"
        description={`Tasks you add here are picked up by agents and turned into branches on ${workspace.githubRepoFullName}.`}
      />
    </>
  );
}
