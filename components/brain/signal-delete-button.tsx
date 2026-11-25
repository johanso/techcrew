"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";

import { deleteSignalAction } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
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

/** Deletes one entry of the Brain's Activity, after a confirmation. `label` names it for screen readers and the question. */
export function SignalDeleteButton({ workspaceId, signalId, label }: { workspaceId: number; signalId: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [removing, startRemoving] = useTransition();
  const remove = () =>
    startRemoving(async () => {
      setError(undefined);
      const result = await deleteSignalAction(workspaceId, signalId).catch(() => ({ ok: false, message: "We couldn't delete it. Please try again." }));
      if (result.ok) setOpen(false);
      else setError(result.message);
    });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete: ${label}`}
        title="Delete"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription className="wrap-anywhere">“{label}” won&apos;t be learned from. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <FormMessage message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Spinner />}
              {removing ? "Deleting…" : "Delete entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
