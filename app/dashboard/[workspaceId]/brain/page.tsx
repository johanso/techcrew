import type { Metadata } from "next";

import { BrainView } from "@/components/brain/brain-view";
import { dashboardHref } from "@/components/dashboard/nav";
import { PROVIDERS } from "@/lib/agent-config";
import { getGithubToken } from "@/lib/github";
import { librarianAccess, librarianFacts } from "@/lib/librarian-run";
import { agentBlock, loadMemory } from "@/lib/memory";
import { activeNotes } from "@/lib/memory-config";
import { currentLibrarianState } from "@/lib/memory-proposals";
import { listProposals, refreshMemoryPullRequests } from "@/lib/memory-proposals-store";
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

/**
 * Brain: the librarian and its proposals, the notes agents read before they work (the project's and the owner's), what
 * they get, what was collected to learn from, and where notes live.
 */
export default async function BrainPage({ params, searchParams }: PageProps<"/dashboard/[workspaceId]/brain">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const shown = parseShown((await searchParams).signals);
  // A missing or unreadable connection shows as a notice on the page, never an error.
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  // First, so a memory pull request merged or closed on GitHub shows as such.
  await refreshMemoryPullRequests(workspace);
  const [memory, activity, access, facts] = await Promise.all([
    loadMemory(workspace, token),
    listSignals(workspace, shown),
    librarianAccess(workspace),
    librarianFacts(workspace.id),
  ]);
  const proposals = await listProposals(workspace, memory);
  const block = agentBlock({ notes: activeNotes([...memory.project, ...memory.global]) });
  const olderSignalsHref =
    activity.hasMore && shown < SIGNALS_PER_WORKSPACE_MAX ? `${dashboardHref(workspace.id, "brain")}?signals=${shown + SIGNALS_PAGE_SIZE}` : null;
  const runsOn = access.ok ? (access.ai ? `It uses your ${PROVIDERS[access.ai.provider].label} API key, not your Claude plan.` : "Simulated on this computer: no model is called.") : "";

  return (
    <BrainView
      workspaceId={workspace.id}
      repoName={workspace.githubRepoFullName}
      repoPrivate={workspace.githubRepoPrivate}
      memory={memory}
      block={block}
      librarian={{
        state: currentLibrarianState(workspace.memoryLibrarian, new Date()),
        access: access.ok ? { ok: true, runsOn } : access,
        unconsumed: facts.unconsumed,
        autoLearn: workspace.memoryAutoLearn,
        bootstrappedAt: workspace.memoryBootstrappedAt?.toISOString() ?? null,
      }}
      proposals={proposals}
      signals={activity.signals}
      olderSignalsHref={olderSignalsHref}
    />
  );
}
