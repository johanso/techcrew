"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { MessageCircleQuestionIcon, XIcon } from "lucide-react";

import { answerRejectionAction, dismissRejectionAction, type SignalFormState } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { ChipChoices, RefusedFindings } from "@/components/brain/signal-form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { REJECTION_REASONS, REJECTION_REASON_LABEL, SIGNAL_TEXT_MAX, type RejectionReason } from "@/lib/memory-signals";
import { cn } from "@/lib/utils";

const OPTIONS = REJECTION_REASONS.map((value) => ({ value, label: REJECTION_REASON_LABEL[value] }));

/**
 * The one question about a pull request closed without merging, on its board card and on the Pull Requests page:
 * answering records why (a Brain signal), dismissing is remembered and it never asks again. Closing the dialog leaves
 * the question for later.
 */
export function RejectionPrompt({
  workspaceId,
  pullRequest,
  onResolved,
  className,
}: {
  workspaceId: number;
  pullRequest: { id: number; number: number };
  /** The question was answered or dismissed (the board keeps its own state; other pages re-render on their own). */
  onResolved?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [dismissing, startDismissing] = useTransition();

  const resolve = () => {
    setOpen(false);
    onResolved?.();
  };
  const dismiss = () =>
    startDismissing(async () => {
      setError(undefined);
      const result = await dismissRejectionAction(workspaceId, pullRequest.id).catch(() => ({ ok: false, message: "We couldn't dismiss the question. Please try again." }));
      if (result.ok) resolve();
      else setError(result.message);
    });

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 py-1 pr-1 pl-2.5">
        <MessageCircleQuestionIcon aria-hidden className="size-3.5 shrink-0 text-warning" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-xs font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Why was PR #{pullRequest.number} rejected?
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          disabled={dismissing}
          aria-label={`Don't ask why PR #${pullRequest.number} was rejected`}
          title="Don't ask"
          className="text-muted-foreground"
        >
          {dismissing ? <Spinner /> : <XIcon />}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Why was PR #{pullRequest.number} rejected?</DialogTitle>
            <DialogDescription>It was closed without merging. Your answer is kept in the Brain, so the same thing can be avoided next time.</DialogDescription>
          </DialogHeader>
          {open && <ReasonForm workspaceId={workspaceId} pullRequestId={pullRequest.id} dismissing={dismissing} onDismiss={dismiss} onSaved={resolve} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReasonForm({
  workspaceId,
  pullRequestId,
  dismissing,
  onDismiss,
  onSaved,
}: {
  workspaceId: number;
  pullRequestId: number;
  dismissing: boolean;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState<SignalFormState, FormData>(answerRejectionAction.bind(null, workspaceId, pullRequestId), {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [reason, setReason] = useState<RejectionReason | null>(null);

  // Closing twice changes nothing, so a re-render with a new callback is harmless.
  useEffect(() => {
    if (state.ok) onSaved();
  }, [state, onSaved]);

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
      <ChipChoices name="reason" legend="Reason" options={OPTIONS} value={reason} onChange={setReason} error={errorFor("reason")} />
      <Field data-invalid={!!errorFor("text")}>
        <FieldLabel htmlFor={`rejection-note-${pullRequestId}`}>Anything to add? (optional)</FieldLabel>
        <Textarea
          id={`rejection-note-${pullRequestId}`}
          name="text"
          className="min-h-20"
          maxLength={SIGNAL_TEXT_MAX}
          placeholder="Keep the existing form components instead of adding new ones."
          aria-invalid={!!errorFor("text")}
        />
        <FieldError>{errorFor("text")}</FieldError>
        <FieldDescription>In your own words. No secrets.</FieldDescription>
      </Field>
      <FormMessage message={state.message} />
      <RefusedFindings findings={state.findings} />
      <DialogFooter>
        <Button type="button" variant="ghost" className="h-10 sm:mr-auto" onClick={onDismiss} disabled={dismissing || pending}>
          {dismissing && <Spinner />}
          Don&apos;t ask
        </Button>
        <Button type="submit" className="h-10" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save reason"}
        </Button>
      </DialogFooter>
    </form>
  );
}
