import Link from "next/link";
import { FileWarningIcon, FolderGitIcon, InfoIcon, PlugZapIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { NoteRow } from "@/components/brain/note-row";
import { dashboardHref } from "@/components/dashboard/nav";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { buttonVariants } from "@/components/ui/button";
import { CORE_FILE, MEMORY_DIR, type MemoryNote } from "@/lib/memory-config";
import type { MemoryProblem } from "@/lib/memory";
import type { SkippedFile } from "@/lib/memory-loader";
import { reconnectHref } from "@/lib/safe-redirect";

/**
 * Mode `repo`: the notes the repository holds under .techteam/memory/, read-only here. The files are the truth, so
 * they change with a pull request in the repository (the owner's, or the memory pull request), not on this page.
 */
export function RepoNotes({
  workspaceId,
  repoName,
  notes,
  skipped,
  found,
  problem,
}: {
  workspaceId: number;
  repoName: string;
  notes: MemoryNote[];
  skipped: SkippedFile[];
  found: boolean;
  problem: MemoryProblem | null;
}) {
  return (
    <section className="surface flex flex-col" aria-label="Project notes">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <FolderGitIcon />
          </span>
        }
        title="Project notes"
        description={
          <>
            Read from <span className="font-mono">{MEMORY_DIR}/</span> in {repoName}
          </>
        }
      />
      <p className="flex items-start gap-2 border-b border-border/70 px-6 py-3 text-xs text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Edit these files in the repository ({MEMORY_DIR}/), or send accepted proposals there with the memory pull request above.
      </p>
      {problem && (
        <div role="status" className="flex flex-col items-start gap-3 border-b border-border/70 bg-warning/5 px-6 py-3 text-sm sm:flex-row sm:items-center">
          <p className="flex min-w-0 flex-1 items-start gap-2">
            <PlugZapIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {problem === "reconnect"
              ? "GitHub rejected the saved connection, so the notes couldn't be read. Agents run without project notes until you reconnect."
              : "GitHub couldn't be reached, so the notes couldn't be read. Agents run without project notes until it answers."}
          </p>
          {problem === "reconnect" && (
            <Link href={reconnectHref(dashboardHref(workspaceId, "brain"))} className={buttonVariants({ variant: "outline", className: "h-9" })}>
              <GitHubIcon className="size-4" />
              Reconnect GitHub
            </Link>
          )}
        </div>
      )}
      {notes.length ? (
        <ul className="flex flex-col divide-y divide-border/70" aria-label="Notes in the repository">
          {notes.map((note) => (
            <NoteRow key={note.key} note={note} />
          ))}
        </ul>
      ) : !problem ? (
        <SurfaceEmpty
          icon={FolderGitIcon}
          title={found ? "No usable notes in the folder" : "No project memory yet"}
          description={found ? "Every file in the folder was skipped (see below)." : `Add ${CORE_FILE} to the repository, a short file with how work is done there. Agents read it before every stage.`}
        />
      ) : null}
      <SkippedList skipped={skipped} noun="file" />
    </section>
  );
}

/** Files or notes that weren't loaded, with why: a count that opens into the reasons. Nothing when none were skipped. */
export function SkippedList({ skipped, noun }: { skipped: SkippedFile[]; noun: "file" | "note" }) {
  if (!skipped.length) return null;
  return (
    <details className="border-t border-border/70 px-6 py-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <FileWarningIcon aria-hidden className="size-4 text-warning" />
        <span>
          <span className="tabular-nums">{skipped.length}</span> {noun}
          {skipped.length === 1 ? "" : "s"} skipped
        </span>
      </summary>
      <ul className="mt-3 flex flex-col gap-2.5">
        {skipped.map((file) => (
          <li key={file.file} className="flex min-w-0 flex-col gap-0.5 text-xs">
            <span className="truncate font-mono font-semibold">{file.file}</span>
            <span className="text-muted-foreground">{file.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
