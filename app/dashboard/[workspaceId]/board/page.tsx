import type { Metadata } from "next";

import { KanbanBoard } from "@/components/board/kanban-board";
import { getBoardData } from "@/lib/board";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params }: PageProps<"/dashboard/[workspaceId]/board">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const data = await getBoardData(workspace);
  return <KanbanBoard workspaceId={workspace.id} initial={data} repo={workspace.githubRepoFullName} />;
}
