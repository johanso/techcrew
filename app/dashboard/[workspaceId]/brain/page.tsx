import type { Metadata } from "next";

import { BrainView } from "@/components/brain/brain-view";
import { getGithubToken } from "@/lib/github";
import { agentBlock, loadMemory } from "@/lib/memory";
import { activeNotes } from "@/lib/memory-config";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Brain" };

/** Brain: the notes agents read before they work (the project's and the owner's), what they get, and where they live. */
export default async function BrainPage({ params }: PageProps<"/dashboard/[workspaceId]/brain">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  // A missing or unreadable connection shows as a notice on the page, never an error.
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  const memory = await loadMemory(workspace, token);
  const block = agentBlock({ notes: activeNotes([...memory.project, ...memory.global]) });

  return <BrainView workspaceId={workspace.id} repoName={workspace.githubRepoFullName} repoPrivate={workspace.githubRepoPrivate} memory={memory} block={block} />;
}
