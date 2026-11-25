import { BanIcon, BrainIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";

import { BlockPreview } from "@/components/brain/block-preview";
import { LibrarianCard, type LibrarianCardProps } from "@/components/brain/librarian-card";
import { MemoryModeForm } from "@/components/brain/memory-mode-form";
import { NoteLibrary } from "@/components/brain/note-library";
import { ProposalInbox } from "@/components/brain/proposal-inbox";
import { RepoNotes, SkippedList } from "@/components/brain/repo-notes";
import { SignalActivity } from "@/components/brain/signal-activity";
import { PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import type { LoadedMemory } from "@/lib/memory";
import { MEMORY_DIR, type MemoryBlock } from "@/lib/memory-config";
import type { ProposalView } from "@/lib/memory-proposals";
import { collectsSignals } from "@/lib/memory-signals";
import type { SignalView } from "@/lib/memory-signals-store";

const tile = (icon: React.ReactNode) => <span className="icon-tile text-brand-emphasis">{icon}</span>;

/**
 * The Brain page's markup: the librarian and its proposals, this project's notes, the owner's own, what agents get, the
 * activity and the settings.
 */
export function BrainView({
  workspaceId,
  repoName,
  repoPrivate,
  memory,
  block,
  librarian,
  proposals,
  signals,
  olderSignalsHref,
}: {
  workspaceId: number;
  repoName: string;
  repoPrivate: boolean;
  memory: LoadedMemory;
  block: MemoryBlock;
  librarian: Omit<LibrarianCardProps, "workspaceId">;
  /** What waits for the owner, and what is in the memory pull request. */
  proposals: ProposalView[];
  /** The newest signals for Activity, and the link to a longer list when there are more. */
  signals: SignalView[];
  olderSignalsHref: string | null;
}) {
  const inRepository = (file: string) => file.startsWith(`${MEMORY_DIR}/`);
  // Notes stored by TechTeam that the scan refused when they were read back (a rule may have grown since they were saved).
  const storedSkipped = memory.skipped.filter((skipped) => !inRepository(skipped.file));
  return (
    <>
      <PageHeader
        eyebrow="Memory"
        title="Brain"
        description="What your agents know before they start: how this project is worked on, and how you like work done. Notes are reference data. They can never change an agent's rules, tools or permissions."
      />

      <LibrarianCard workspaceId={workspaceId} {...librarian} />
      <ProposalInbox workspaceId={workspaceId} mode={memory.mode} proposals={proposals} />

      {memory.mode === "repo" && <RepoNotes workspaceId={workspaceId} repoName={repoName} notes={memory.project} skipped={memory.skipped.filter((skipped) => inRepository(skipped.file))} found={memory.repoFound} problem={memory.problem} />}
      {memory.mode === "local" && (
        <NoteLibrary
          workspaceId={workspaceId}
          scope="project"
          notes={memory.project}
          title="Project notes"
          description="Kept by TechTeam for this project. Nothing is added to the repository."
          icon={tile(<BrainIcon />)}
          emptyTitle="No project notes yet"
          emptyDescription="Write the conventions a new teammate would need: how tests run, how code is organized, what to avoid."
        />
      )}
      {memory.mode === "off" && (
        <section className="surface flex flex-col" aria-label="Project notes">
          <SurfaceHeader icon={tile(<BrainIcon />)} title="Project notes" description="Project memory is off." />
          <SurfaceEmpty icon={BanIcon} title="Memory is off for this project" description="Agents get no notes, neither this project's nor yours. Turn it on in the settings below." />
        </section>
      )}

      {memory.mode !== "off" && (
        <NoteLibrary
          workspaceId={workspaceId}
          scope="global"
          notes={memory.global}
          title="Your memory"
          description="Shared across all your projects: what you prefer, whatever the repository."
          icon={tile(<UserRoundIcon />)}
          emptyTitle="No notes of your own yet"
          emptyDescription="Preferences that apply everywhere, such as how small pull requests should be or how you like summaries written."
        >
          <p className="flex items-start gap-2 border-b border-border/70 bg-warning/5 px-6 py-3 text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Every project of yours reads these notes. Keep them free of project details: no repository names, paths or customer names.
          </p>
        </NoteLibrary>
      )}

      {storedSkipped.length > 0 && (
        <section className="surface" aria-label="Notes that were skipped">
          <SkippedList skipped={storedSkipped} noun="note" />
        </section>
      )}

      <BlockPreview block={block} />
      <SignalActivity workspaceId={workspaceId} signals={signals} olderHref={olderSignalsHref} paused={!collectsSignals(memory.mode)} />
      <MemoryModeForm workspaceId={workspaceId} mode={memory.mode} autoLearn={librarian.autoLearn} repoPrivate={repoPrivate} />
    </>
  );
}
