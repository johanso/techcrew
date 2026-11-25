"use client";

import { startTransition, useActionState, useEffect, useState } from "react";

import { acceptProposalAction, editProposalAction, type ProposalFormState } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { CheckRow } from "@/components/brain/check-row";
import { NoteFields } from "@/components/brain/note-editor";
import { SkillFindings } from "@/components/skills/skill-findings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFieldErrors } from "@/hooks/use-field-errors";
import type { ProposalView } from "@/lib/memory-proposals";

type Props = {
  workspaceId: number;
  proposal: ProposalView;
  /** Accept on this page, or save the edit and keep it waiting for the memory pull request. */
  accepts: boolean;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  /** What became of the proposal once it left the inbox: its card can't say it. */
  onNotice: (notice: Notice) => void;
  onClose: () => void;
};

/** What the inbox says about the last thing done. */
export type Notice = { ok: boolean; message?: string };

/** Edit a proposal's note: "Edit then accept" in the inbox, or save the edit before the memory pull request. */
export function ProposalEditDialog({ open, ...props }: Props & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.accepts ? "Edit then accept" : "Edit the proposed note"}</DialogTitle>
          <DialogDescription>
            {props.accepts ? "Change what you want, then accept it into the notes." : "Change what you want. It goes to the repository when you open the memory pull request."}
          </DialogDescription>
        </DialogHeader>
        {open && <EditForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ workspaceId, proposal, accepts, confirmed, onConfirm, onNotice, onClose }: Props) {
  const action = accepts ? acceptProposalAction : editProposalAction;
  const [state, formAction, pending] = useActionState<ProposalFormState, FormData>(async (previous, data) => {
    const result = await action(workspaceId, proposal.id, previous, data);
    if (result.ok || result.gone) onNotice({ ok: Boolean(result.ok), message: result.message });
    return result;
  }, {});
  const { errorFor, onChange } = useFieldErrors(state);
  // The note the proposal would write, as it was opened.
  const [note] = useState(proposal.note);

  useEffect(() => {
    if (state.ok || state.gone) onClose();
  }, [state, onClose]);

  const needsConfirm = accepts && proposal.untrustedOrigin;

  return (
    <form
      // Dispatched by hand: a form `action` clears the fields afterwards, which would lose what was typed when the server refuses.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      onChange={onChange}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="edited" value="1" />
      <NoteFields note={note} errorFor={errorFor} />
      {needsConfirm && (
        <CheckRow name="confirmed" checked={confirmed} onChange={onConfirm}>
          I checked this note against its evidence. It is based only on text from agents, CI or the repository.
        </CheckRow>
      )}
      <FormMessage message={state.message} />
      {state.findings && state.findings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/50 p-3">
          <p role="status" className="text-xs font-semibold">
            The security scan refused this note
          </p>
          <SkillFindings findings={state.findings} />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="h-10" disabled={pending || (needsConfirm && !confirmed)}>
          {pending && <Spinner />}
          {accepts ? (pending ? "Accepting…" : "Accept with changes") : pending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
