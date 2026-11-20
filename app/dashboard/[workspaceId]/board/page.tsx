import type { Metadata } from "next";

import { KanbanBoard } from "@/components/board/kanban-board";
import { teamProviders } from "@/lib/agents";
import { getAIKeys, keyStatus } from "@/lib/ai-keys";
import { getBoardData } from "@/lib/board";
import { linkCaptureAvailable } from "@/lib/sandbox/capture";
import { isStorageConfigured } from "@/lib/storage";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params, searchParams }: PageProps<"/dashboard/[workspaceId]/board">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const [data, keys, inUse] = await Promise.all([getBoardData(workspace), getAIKeys(workspace.id), teamProviders(workspace.id)]);
  // ?log=<card id> (from a notification) opens that card's agent log; ignored unless the card is on this board.
  const log = (await searchParams).log;
  const openLogFor = typeof log === "string" && data.cards[log] ? log : null;
  return (
    <KanbanBoard
      workspaceId={workspace.id}
      initial={data}
      repo={workspace.githubRepoFullName}
      lastSyncedAt={workspace.githubIssuesSyncedAt?.toISOString() ?? null}
      ai={{ inUse, connected: keyStatus(keys) }}
      openLogFor={openLogFor}
      referencesEnabled={isStorageConfigured()}
      linksEnabled={linkCaptureAvailable()}
    />
  );
}
