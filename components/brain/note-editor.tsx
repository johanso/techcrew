"use client";

import { startTransition, useActionState, useEffect, useState } from "react";

import { saveNoteAction, type MemoryScopeName, type NoteFormState } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { SkillFindings } from "@/components/skills/skill-findings";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { MEMORY_TYPES, MEMORY_TYPE_META, NOTE_BODY_MAX, NOTE_TITLE_MAX, isMemoryType, type MemoryLoad, type MemoryNote, type MemoryType, type NoteField } from "@/lib/memory-config";

const TYPE_ITEMS = MEMORY_TYPES.map((value) => ({ value, label: `${MEMORY_TYPE_META[value].label}: ${MEMORY_TYPE_META[value].hint}` }));
const LOAD_ITEMS: { value: MemoryLoad; label: string }[] = [
  { value: "on_demand", label: "On demand: agents search for it when it fits" },
  { value: "always", label: "Always: part of every agent's prompt (keep these few)" },
];
const isLoad = (value: unknown): value is MemoryLoad => value === "always" || value === "on_demand";

/**
 * Create (`note` null) or edit a note in a dialog. The scan runs on the server: a critical finding refuses the note and
 * is listed here, anything milder is shown after saving. Fields keep what was typed when the server refuses.
 */
export function NoteDialog({
  workspaceId,
  scope,
  note,
  open,
  onClose,
}: {
  workspaceId: number;
  scope: MemoryScopeName;
  note: MemoryNote | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : scope === "global" ? "New note for all your projects" : "New project note"}</DialogTitle>
          <DialogDescription>
            {scope === "global"
              ? "Agents in every project of yours read this. Keep it free of project details."
              : "Agents working on this project read this. Write what a new teammate would need to know, not code."}
          </DialogDescription>
        </DialogHeader>
        {/* A fresh form (and its state) every time the dialog opens or another note is edited. */}
        {open && <NoteForm key={note?.id ?? "new"} workspaceId={workspaceId} scope={scope} note={note} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({ workspaceId, scope, note, onClose }: { workspaceId: number; scope: MemoryScopeName; note: MemoryNote | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState<NoteFormState, FormData>(saveNoteAction.bind(null, workspaceId, scope, note?.id ?? null), {});
  const { errorFor, onChange } = useFieldErrors(state);

  // Saved with nothing to say: the page behind already shows the note. Saved with warnings: they stay on screen until "Done".
  const warned = Boolean(state.ok && state.findings?.length);
  useEffect(() => {
    if (state.ok && !warned) onClose();
  }, [state, warned, onClose]);

  const blocked = state.findings?.some((finding) => finding.severity === "critical");

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
      <NoteFields note={note} errorFor={errorFor} />

      <FormMessage message={state.message} />
      {state.findings && state.findings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/50 p-3">
          <p role="status" className="text-xs font-semibold">
            {blocked ? "The security scan refused this note" : "Saved. The security scan has warnings"}
          </p>
          <SkillFindings findings={state.findings} />
        </div>
      )}

      <DialogFooter>
        {warned ? (
          <Button type="button" className="h-10" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" className="h-10" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-10" disabled={pending}>
              {pending && <Spinner />}
              {pending ? "Saving…" : note ? "Save changes" : "Add note"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/** A note's fields (title, type, load, text, files), shared by the note dialog and a proposal's edit dialog. */
export function NoteFields({
  note,
  errorFor,
}: {
  note: Pick<MemoryNote, "title" | "type" | "load" | "body" | "paths"> | null;
  errorFor: (field: NoteField) => string | undefined;
}) {
  const [type, setType] = useState<MemoryType>(note?.type ?? "convention");
  const [load, setLoad] = useState<MemoryLoad>(note?.load ?? "on_demand");
  const [body, setBody] = useState(note?.body ?? "");

  return (
    <>
      <Field data-invalid={!!errorFor("title")}>
        <FieldLabel htmlFor="note-title">Title</FieldLabel>
        <Input
          id="note-title"
          name="title"
          className="h-10"
          defaultValue={note?.title ?? ""}
          maxLength={NOTE_TITLE_MAX}
          placeholder="Tests run with vitest, not jest"
          autoComplete="off"
          aria-invalid={!!errorFor("title")}
        />
        <FieldError>{errorFor("title")}</FieldError>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={!!errorFor("type")}>
          <FieldLabel htmlFor="note-type">Type</FieldLabel>
          <input type="hidden" name="type" value={type} />
          <Select items={TYPE_ITEMS} value={type} onValueChange={(value) => isMemoryType(value) && setType(value)}>
            <SelectTrigger id="note-type" className="w-full data-[size=default]:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errorFor("type")}</FieldError>
        </Field>
        <Field data-invalid={!!errorFor("load")}>
          <FieldLabel htmlFor="note-load">When it loads</FieldLabel>
          <input type="hidden" name="load" value={load} />
          <Select items={LOAD_ITEMS} value={load} onValueChange={(value) => isLoad(value) && setLoad(value)}>
            <SelectTrigger id="note-load" className="w-full data-[size=default]:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOAD_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errorFor("load")}</FieldError>
        </Field>
      </div>

      <Field data-invalid={!!errorFor("body")}>
        <FieldLabel htmlFor="note-body">Note</FieldLabel>
        <Textarea
          id="note-body"
          name="body"
          className="min-h-32"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="`npm test` uses vitest. A new test goes next to its module (foo.ts -> foo.test.ts)."
          aria-invalid={!!errorFor("body")}
          aria-describedby="note-body-count"
        />
        <FieldError>{errorFor("body")}</FieldError>
        <FieldDescription id="note-body-count" className="tabular-nums">
          {body.trim().length} / {NOTE_BODY_MAX} characters. A short summary: no file contents, no secrets.
        </FieldDescription>
      </Field>

      <Field data-invalid={!!errorFor("paths")}>
        <FieldLabel htmlFor="note-paths">Relevant files (optional)</FieldLabel>
        <Textarea
          id="note-paths"
          name="paths"
          className="min-h-16 font-mono"
          defaultValue={note?.paths.join("\n") ?? ""}
          placeholder={"src/**/*.test.ts\ndocs/**"}
          spellCheck={false}
          aria-invalid={!!errorFor("paths")}
        />
        <FieldError>{errorFor("paths")}</FieldError>
        <FieldDescription>One pattern per line. The note ranks higher when a card touches matching files.</FieldDescription>
      </Field>
    </>
  );
}
