"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { BanIcon, CircleCheckIcon } from "lucide-react";

import { rememberAction, type SignalFormState } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { ChipChoices, RefusedFindings } from "@/components/brain/signal-form-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { REMEMBER_MAX, SIGNAL_SCOPES, SIGNAL_SCOPE_LABEL, type SignalScope } from "@/lib/memory-signals";

const SCOPES = SIGNAL_SCOPES.map((value) => ({ value, label: SIGNAL_SCOPE_LABEL[value] }));

/** What "Remember this" was used on: a card (`stepId` null) or an entry of its agent log, with the starting text. */
export type RememberTarget = {
  cardId: string;
  cardKey: string;
  stepId: number | null;
  text: string;
  /** The starting text isn't the owner's (a GitHub issue's title, an agent's log entry): saved unchanged, it stays untrusted. */
  someoneElses: boolean;
};

/** Remember this: the owner edits a short note and where it applies; it is saved as a Brain signal. */
export function RememberDialog({
  workspaceId,
  memoryOff,
  target,
  onClose,
}: {
  workspaceId: number;
  /** The project's memory is off: the note is still saved, and the dialog says it waits. */
  memoryOff: boolean;
  target: RememberTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remember this</DialogTitle>
          <DialogDescription>
            {target ? `From ${target.cardKey}. ` : ""}It is collected in the Brain to learn from; agents don&apos;t read it as it is.
          </DialogDescription>
        </DialogHeader>
        {memoryOff && (
          <p className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/60 p-3 text-sm">
            <BanIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            Memory is off for this project, so this is kept for when it is turned on.
          </p>
        )}
        {/* The popup unmounts when closed; keying by the source also resets the form when it changes. */}
        {target && <RememberForm key={`${target.cardId}:${target.stepId}`} workspaceId={workspaceId} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RememberForm({ workspaceId, target, onClose }: { workspaceId: number; target: RememberTarget; onClose: () => void }) {
  const [state, formAction, pending] = useActionState<SignalFormState, FormData>(rememberAction.bind(null, workspaceId, target.cardId, target.stepId), {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [text, setText] = useState(target.text);
  const [scope, setScope] = useState<SignalScope>("project");

  if (state.ok) {
    return (
      <>
        <p role="status" className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm ring-1 ring-border/70">
          <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{state.trusted ? "Saved to the Brain." : "Saved to the Brain as someone else's words, because the text wasn't changed."}</span>
        </p>
        <DialogFooter>
          <Link href={`/dashboard/${workspaceId}/brain`} className={buttonVariants({ variant: "outline", className: "h-10" })}>
            Open the Brain
          </Link>
          <Button type="button" className="h-10" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      noValidate
      // Dispatched by hand: a form `action` clears the fields afterwards, which would lose what was typed when the server refuses.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      onChange={onChange}
      className="flex flex-col gap-5"
    >
      <Field data-invalid={!!errorFor("text")}>
        <FieldLabel htmlFor="remember-text">What to remember</FieldLabel>
        <Textarea
          id="remember-text"
          name="text"
          className="min-h-28"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={!!errorFor("text")}
          aria-describedby="remember-text-count"
        />
        <FieldError>{errorFor("text")}</FieldError>
        <FieldDescription id="remember-text-count" className="tabular-nums">
          {text.trim().length} / {REMEMBER_MAX} characters. No secrets.
          {target.someoneElses && " Put it in your own words for it to count as yours."}
        </FieldDescription>
      </Field>
      <ChipChoices name="scope" legend="Where it applies" options={SCOPES} value={scope} onChange={setScope} error={errorFor("scope")} />
      <FormMessage message={state.message} />
      <RefusedFindings findings={state.findings} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="h-10" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Saving…" : "Remember"}
        </Button>
      </DialogFooter>
    </form>
  );
}
