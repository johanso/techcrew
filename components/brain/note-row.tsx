import { FileTextIcon } from "lucide-react";

import { Pill } from "@/components/skills/skill-badges";
import { MEMORY_TYPE_META, type MemoryNote } from "@/lib/memory-config";
import { cn } from "@/lib/utils";

const LOAD_LABEL = { always: "Always loaded", on_demand: "On demand" } as const;

/** One note in a list: title, type, how it loads, its status, where it lives, and the start of its text. */
export function NoteRow({ note, actions }: { note: MemoryNote; actions?: React.ReactNode }) {
  const inactive = note.status !== "active";
  return (
    <li className="flex min-w-0 flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className={cn("truncate text-sm font-bold", inactive && "text-muted-foreground")}>{note.title}</h3>
          <span className="flex flex-wrap items-center gap-1">
            <Pill title={MEMORY_TYPE_META[note.type].hint}>{MEMORY_TYPE_META[note.type].label}</Pill>
            <Pill>{LOAD_LABEL[note.load]}</Pill>
            {note.status !== "active" && <Pill className="bg-warning/10 text-foreground ring-warning/30">{note.status === "stale" ? "Stale" : "Disabled"}</Pill>}
          </span>
        </div>
        <p className={cn("line-clamp-3 text-sm whitespace-pre-line", inactive ? "text-muted-foreground" : "text-foreground/80")}>{note.body}</p>
        {(note.file || note.paths.length > 0) && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {note.file && (
              <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{note.file}</span>
              </span>
            )}
            {note.paths.length > 0 && (
              <span className="min-w-0 truncate" title={note.paths.join(", ")}>
                Relevant to <span className="font-mono">{note.paths.join(", ")}</span>
              </span>
            )}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </li>
  );
}
