"use client";

import { useState, useTransition } from "react";
import { EyeOffIcon, EyeIcon, NotebookPenIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { deleteNoteAction, setNoteStatusAction, type MemoryScopeName } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { NoteDialog } from "@/components/brain/note-editor";
import { NoteRow } from "@/components/brain/note-row";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { NOTES_PER_SCOPE_MAX, type MemoryNote } from "@/lib/memory-config";

/**
 * Notes kept in the database: the owner's own (all projects) or, in mode `local`, this project's. Create, edit, switch off
 * and delete; the text is validated and scanned on the server.
 */
export function NoteLibrary({
  workspaceId,
  scope,
  notes,
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
  children,
}: {
  workspaceId: number;
  scope: MemoryScopeName;
  notes: MemoryNote[];
  title: string;
  description: string;
  icon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  /** Extra content between the header and the list (a warning). */
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState<{ note: MemoryNote | null } | null>(null);
  const [deleting, setDeleting] = useState<MemoryNote | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const full = notes.length >= NOTES_PER_SCOPE_MAX;

  const toggle = (note: MemoryNote) =>
    startTransition(async () => {
      if (note.id === null) return;
      const result = await setNoteStatusAction(workspaceId, scope, note.id, note.status === "disabled" ? "active" : "disabled");
      setMessage(result.ok ? undefined : result.message);
    });

  return (
    <section className="surface flex flex-col" aria-label={title}>
      <SurfaceHeader
        icon={icon}
        title={title}
        description={description}
        actions={
          <Button type="button" className="h-9" disabled={full} onClick={() => setEditing({ note: null })}>
            <PlusIcon data-icon="inline-start" />
            New note
          </Button>
        }
      />
      {children}
      {message && (
        <div className="px-6 pt-4">
          <FormMessage message={message} />
        </div>
      )}
      {notes.length ? (
        <ul className="flex flex-col divide-y divide-border/70" aria-label={title}>
          {notes.map((note) => (
            <NoteRow
              key={note.key}
              note={note}
              actions={
                <>
                  <Button type="button" variant="outline" className="h-9" onClick={() => setEditing({ note })}>
                    <PencilIcon data-icon="inline-start" />
                    Edit
                  </Button>
                  <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => toggle(note)}>
                    {note.status === "disabled" ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
                    {note.status === "disabled" ? "Switch on" : "Switch off"}
                  </Button>
                  <Button type="button" variant="outline" className="h-9" onClick={() => setDeleting(note)}>
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <SurfaceEmpty icon={NotebookPenIcon} title={emptyTitle} description={emptyDescription}>
          <Button type="button" className="h-9" onClick={() => setEditing({ note: null })}>
            <PlusIcon data-icon="inline-start" />
            Write the first note
          </Button>
        </SurfaceEmpty>
      )}
      {full && <p className="px-6 pb-4 text-xs text-muted-foreground">There are {NOTES_PER_SCOPE_MAX} notes here, the most there can be. Delete or merge some to add more.</p>}

      <NoteDialog workspaceId={workspaceId} scope={scope} note={editing?.note ?? null} open={editing !== null} onClose={() => setEditing(null)} />
      {deleting && <DeleteDialog key={deleting.key} workspaceId={workspaceId} scope={scope} note={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function DeleteDialog({ workspaceId, scope, note, onClose }: { workspaceId: number; scope: MemoryScopeName; note: MemoryNote; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [removing, startRemoving] = useTransition();
  const close = () => {
    setOpen(false);
    onClose();
  };
  const remove = () =>
    startRemoving(async () => {
      setError(undefined);
      const result = note.id === null ? { ok: false, message: "Note not found." } : await deleteNoteAction(workspaceId, scope, note.id);
      if (result.ok) close();
      else setError(result.message);
    });

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !removing && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{note.title}”?</AlertDialogTitle>
          <AlertDialogDescription>Agents stop seeing it from their next stage. To keep it but hide it, switch it off instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <FormMessage message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove} disabled={removing}>
            {removing && <Spinner />}
            {removing ? "Deleting…" : "Delete note"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
