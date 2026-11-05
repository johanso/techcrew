"use client";

import { useState, useTransition } from "react";
import { MessageCircleQuestionIcon, SendIcon } from "lucide-react";

import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_MAX, parseAnswer } from "@/lib/agent-run-config";
import type { BoardCard } from "@/lib/board-config";

/** Resolves with an error message to show in the dialog, or nothing on success (the dialog closes). */
export type AnswerSubmit = (card: BoardCard, answer: string) => Promise<string | void>;

/**
 * Answer the analyst: shows the question of the card's latest run, takes the owner's answer and runs the card again
 * (answerCardAction). Opened from the card's Answer button, its ⋯ menu or the agent log.
 */
export function AnswerDialog({
  card,
  onOpenChange,
  onSubmit,
}: {
  card: BoardCard | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: AnswerSubmit;
}) {
  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* The popup unmounts when closed; keying by card also resets the form when switching cards. */}
        {card && (
          <AnswerForm
            key={card.id}
            card={card}
            onSubmit={async (answer) => {
              const error = await onSubmit(card, answer);
              if (!error) onOpenChange(false);
              return error;
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnswerForm({ card, onSubmit }: { card: BoardCard; onSubmit: (answer: string) => Promise<string | void> }) {
  const [answer, setAnswer] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const question = card.run?.status === "needs_info" ? card.run.error : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseAnswer(answer);
        if (!parsed.ok) return setFieldError(parsed.error);
        setFormError(null);
        startTransition(async () => {
          const error = await onSubmit(parsed.value);
          if (error) setFormError(error);
        });
      }}
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-6 pt-6 pb-5">
        <span className="icon-tile text-warning">
          <MessageCircleQuestionIcon />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="eyebrow text-muted-foreground tabular-nums">{card.key}</p>
          <DialogTitle className="text-lg font-bold">Answer the analyst</DialogTitle>
          <DialogDescription className="line-clamp-2">{card.title}</DialogDescription>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-6 py-5">
        <FormMessage message={formError ?? undefined} />

        {question && (
          <figure className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3.5 py-3 ring-1 ring-border/70">
            <figcaption className="eyebrow text-muted-foreground">The analyst asks</figcaption>
            <blockquote className="text-sm whitespace-pre-line">{question}</blockquote>
          </figure>
        )}

        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel htmlFor="analyst-answer">Your answer</FieldLabel>
          <Textarea
            id="analyst-answer"
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              setFieldError(null);
            }}
            placeholder="Give the analyst what it needs to plan the work."
            rows={5}
            maxLength={ANSWER_MAX}
            aria-invalid={fieldError ? true : undefined}
            className="min-h-28 resize-y"
            autoFocus
          />
          <FieldError>{fieldError}</FieldError>
          <FieldDescription>
            The analyst starts again right away, and the agents keep your answer for every later run of this card.
            {card.github && ` If the question is on issue #${card.github.number}, your answer is posted there too.`}
          </FieldDescription>
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
        <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
        <Button type="submit" className="h-10 px-4" disabled={pending}>
          {pending ? <Spinner /> : <SendIcon />}
          {pending ? "Starting the analyst…" : "Answer and run"}
        </Button>
      </div>
    </form>
  );
}
