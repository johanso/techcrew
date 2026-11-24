"use client";

import { useState, useTransition } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ExternalLinkIcon, PlusIcon, SaveIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { FormMessage } from "@/components/auth/form-parts";
import { CardReferences } from "@/components/board/card-references";
import { ISSUE_TYPE_META, PRIORITY_META } from "@/components/board/issue-meta";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  BOARD_COLUMNS,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  isBoardColumnId,
  LABELS_MAX,
  TITLE_MAX,
  type BoardCard,
  type BoardCardInput,
  type BoardColumnId,
  type IssuePriority,
  type IssueType,
} from "@/lib/board-config";
import { cn } from "@/lib/utils";

/** What the dialog is for: a blank card with presets, or an existing card's details. */
export type CardDialogMode =
  | { kind: "create"; type: IssueType; status: BoardColumnId }
  | { kind: "edit"; card: BoardCard; status: BoardColumnId };

/** Resolves with an error message to show in the dialog, or nothing on success (the dialog closes). */
export type CardDialogSubmit = (input: BoardCardInput) => Promise<string | void>;

/**
 * The References section's needs: the workspace, whether storage is set up, whether links can be captured (a sandbox
 * host), and where a card's new count goes.
 */
export type CardDialogReferences = { workspaceId: number; links: boolean; onCountChange: (cardId: string, count: number) => void };

export function CardDialog({
  open,
  onOpenChange,
  mode,
  onSubmit,
  references,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CardDialogMode;
  onSubmit: CardDialogSubmit;
  references: CardDialogReferences;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {/* The popup unmounts when closed; keying by card also resets the form when switching cards. */}
        <CardForm
          key={mode.kind === "edit" ? mode.card.id : "new"}
          mode={mode}
          references={references}
          onSubmit={async (input) => {
            const error = await onSubmit(input);
            if (!error) onOpenChange(false);
            return error;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ mode, onSubmit, references }: { mode: CardDialogMode; onSubmit: CardDialogSubmit; references: CardDialogReferences }) {
  const card = mode.kind === "edit" ? mode.card : null;
  // GitHub owns a synced card's title, description and labels (see lib/github-issues.ts).
  const synced = card?.github ?? null;
  const [type, setType] = useState<IssueType>(card?.type ?? (mode.kind === "create" ? mode.type : "feature"));
  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [priority, setPriority] = useState<IssuePriority>(card?.priority ?? "medium");
  const [status, setStatus] = useState<BoardColumnId>(mode.status);
  const [dueDate, setDueDate] = useState(card?.dueDate ?? "");
  const [labels, setLabels] = useState(card?.labels.join(", ") ?? "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typeMeta = ISSUE_TYPE_META[type];
  const noun = typeMeta.label.toLowerCase();
  const statusItems = BOARD_COLUMNS.map((c) => ({ value: c.id, label: c.title }));

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return setTitleError(`Give the ${noun} a title.`);
        setFormError(null);
        startTransition(async () => {
          const error = await onSubmit({
            type,
            title: trimmed,
            description: description.trim(),
            priority,
            status,
            dueDate: dueDate || null,
            // "auth, UI , auth" → ["auth", "ui"]; the server applies the same rules.
            labels: [...new Set(labels.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean))].slice(0, LABELS_MAX),
          });
          if (error) setFormError(error);
        });
      }}
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-6 pt-6 pb-5">
        <span className={cn("icon-tile", typeMeta.tone)}>
          <typeMeta.icon />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          {card && (
            <p className="eyebrow text-muted-foreground tabular-nums">
              {card.key}
              {synced && ` · GitHub #${synced.number}`}
            </p>
          )}
          <DialogTitle className="text-lg font-bold">{card ? `${typeMeta.label} details` : `New ${noun}`}</DialogTitle>
          <DialogDescription>
            {card ? "Review and update this card." : "Add the details your AI team needs to pick this up."}
          </DialogDescription>
        </div>
      </div>

      <FieldGroup className="gap-5 px-6 py-5">
        <FormMessage message={formError ?? undefined} />

        {synced && (
          <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-3.5 py-3 text-sm ring-1 ring-border/70">
            <GitHubIcon className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1 text-muted-foreground">
              Synced from{" "}
              <span className="font-semibold text-foreground">
                issue #{synced.number} ({synced.state})
              </span>
              . Title, description and labels are managed on GitHub; type, priority, status and due date are yours.
            </p>
            <a
              href={synced.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm", className: "shrink-0" })}
            >
              Open
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </div>
        )}

        <FieldSet className="gap-2.5">
          <FieldLegend variant="label">Type</FieldLegend>
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-2">
            {ISSUE_TYPES.map((value) => {
              const meta = ISSUE_TYPE_META[value];
              return (
                <label key={value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      "flex h-full flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:bg-accent",
                      "peer-checked:border-brand/50 peer-checked:bg-brand/5 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
                    )}
                  >
                    <meta.icon className={cn("size-4", meta.tone)} />
                    <span className="text-sm font-semibold">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </FieldSet>

        <Field data-invalid={!!titleError}>
          <FieldLabel htmlFor="card-title">Title</FieldLabel>
          <Input
            id="card-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(null);
            }}
            placeholder={
              type === "bug" ? "e.g. Logo upload fails for large PNGs" : type === "feature" ? "e.g. Invite teammates by email" : "e.g. Upgrade to the latest Next.js"
            }
            maxLength={synced ? undefined : TITLE_MAX}
            aria-invalid={!!titleError}
            readOnly={!!synced}
            className={cn("h-10", synced && "bg-muted/50 text-muted-foreground")}
            autoFocus={!card}
            required
          />
          <FieldError>{titleError}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="card-description">Description</FieldLabel>
          <Textarea
            id="card-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={
              type === "bug"
                ? "Steps to reproduce, what you expected, and what happened instead."
                : "What should be built, and how will we know it's done?"
            }
            rows={4}
            readOnly={!!synced}
            className={cn("min-h-24 resize-y", synced && "max-h-60 bg-muted/50 text-muted-foreground")}
          />
        </Field>

        <FieldSet className="gap-2.5">
          <FieldLegend variant="label">Priority</FieldLegend>
          <div role="radiogroup" aria-label="Priority" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ISSUE_PRIORITIES.map((value) => (
              <label key={value} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  value={value}
                  checked={priority === value}
                  onChange={() => setPriority(value)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-9 items-center justify-center gap-2 rounded-lg border bg-card text-sm font-medium transition-colors hover:bg-accent",
                    "peer-checked:border-brand/50 peer-checked:bg-brand/5 peer-checked:text-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
                  )}
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", PRIORITY_META[value].dot)} />
                  {PRIORITY_META[value].label}
                </span>
              </label>
            ))}
          </div>
        </FieldSet>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="card-status">Status</FieldLabel>
            <Select items={statusItems} value={status} onValueChange={(value) => isBoardColumnId(value) && setStatus(value)}>
              <SelectTrigger id="card-status" className="w-full data-[size=default]:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="card-due">Due date</FieldLabel>
            <Input id="card-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-10" />
          </Field>

          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="card-labels">Labels</FieldLabel>
            <Input
              id="card-labels"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder="auth, ui"
              autoComplete="off"
              readOnly={!!synced}
              className={cn("h-10", synced && "bg-muted/50 text-muted-foreground")}
            />
            <FieldDescription className="text-xs">
              {synced ? "Labels come from GitHub." : `Comma-separated, up to ${LABELS_MAX}.`}
            </FieldDescription>
          </Field>
        </div>

        {/* Board-owned, so GitHub-synced cards take references too. Saved as they're added, not with the form. */}
        <CardReferences
          workspaceId={references.workspaceId}
          cardId={card?.id ?? null}
          links={references.links}
          expected={card?.references ?? 0}
          onCountChange={card ? (count) => references.onCountChange(card.id, count) : undefined}
        />
      </FieldGroup>

      <div className="flex flex-col-reverse gap-3 border-t border-border/70 bg-muted/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
        {card && (
          <p className="text-xs text-muted-foreground sm:mr-auto">
            Created {format(new Date(card.createdAt), "MMM d, yyyy")}
            {card.updatedAt !== card.createdAt && ` · Updated ${formatDistanceToNowStrict(new Date(card.updatedAt), { addSuffix: true })}`}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
          <Button type="submit" className="h-10 px-4" disabled={pending}>
            {pending ? <Spinner /> : card ? <SaveIcon /> : <PlusIcon />}
            {pending ? (card ? "Saving…" : "Creating…") : card ? "Save changes" : `Create ${noun}`}
          </Button>
        </div>
      </div>
    </form>
  );
}
