import type { Metadata } from "next";

import { BrainView } from "@/components/brain/brain-view";
import { dashboardHref } from "@/components/dashboard/nav";
import { getGithubToken } from "@/lib/github";
import { agentBlock, loadMemory } from "@/lib/memory";
import { activeNotes } from "@/lib/memory-config";
import { SIGNALS_PAGE_SIZE, SIGNALS_PER_WORKSPACE_MAX } from "@/lib/memory-signals";
import { listSignals } from "@/lib/memory-signals-store";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Brain" };

/** `?signals=` from Activity's "Show more": how many entries to list, in page-size steps up to all that are kept. */
function parseShown(value: string | string[] | undefined) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= SIGNALS_PAGE_SIZE) return SIGNALS_PAGE_SIZE;
  return Math.min(Math.ceil(n / SIGNALS_PAGE_SIZE) * SIGNALS_PAGE_SIZE, SIGNALS_PER_WORKSPACE_MAX);
}

/** Brain: the notes agents read before they work (the project's and the owner's), what they get, what was collected to learn from, and where notes live. */
export default async function BrainPage({ params, searchParams }: PageProps<"/dashboard/[workspaceId]/brain">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const shown = parseShown((await searchParams).signals);
  // A missing or unreadable connection shows as a notice on the page, never an error.
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  const [memory, activity] = await Promise.all([loadMemory(workspace, token), listSignals(workspace, shown)]);
  const block = agentBlock({ notes: activeNotes([...memory.project, ...memory.global]) });
  const olderSignalsHref =
    activity.hasMore && shown < SIGNALS_PER_WORKSPACE_MAX ? `${dashboardHref(workspace.id, "brain")}?signals=${shown + SIGNALS_PAGE_SIZE}` : null;

  return (
    <BrainView
      workspaceId={workspace.id}
      repoName={workspace.githubRepoFullName}
      repoPrivate={workspace.githubRepoPrivate}
      memory={memory}
      block={block}
      signals={activity.signals}
      olderSignalsHref={olderSignalsHref}
    />
  );
}
