import { ScrollTextIcon } from "lucide-react";

import { SurfaceHeader } from "@/components/dashboard/page-header";
import { CORE_OWNER_MAX, CORE_PROJECT_MAX, type MemoryBlock } from "@/lib/memory-config";

function Meter({ label, used, max, detail }: { label: string; used: number; max: number; detail: string }) {
  const percent = Math.min(100, Math.round((used / max) * 100));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used} / {max} characters
        </span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used} aria-valuetext={`${used} of ${max} characters`} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand-emphasis" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "What agents get": the exact text added to every stage's prompt, and its size against the limits. */
export function BlockPreview({ block }: { block: MemoryBlock }) {
  const loaded = block.project.included + block.owner.included;
  return (
    <section className="surface flex flex-col" aria-label="What agents get">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <ScrollTextIcon />
          </span>
        }
        title="What agents get"
        description="The notes that load in every stage, exactly as sent."
      />
      <div className="grid gap-5 p-6 sm:grid-cols-2">
        <Meter label="This project" used={block.projectChars} max={CORE_PROJECT_MAX} detail={`${count(block.project.included, "always-loaded note")} of ${block.project.total} fit.`} />
        <Meter label="Your memory" used={block.ownerChars} max={CORE_OWNER_MAX} detail={`${count(block.owner.included, "always-loaded note")} of ${block.owner.total} fit.`} />
      </div>
      <p className="px-6 text-xs text-muted-foreground">
        {block.searchable > 0
          ? `${count(block.searchable, "more note")} can be found with search_memory when the work needs them.`
          : loaded
            ? "Every note is in the block; nothing is left to search."
            : "Agents get nothing from the Brain yet."}
      </p>
      <div className="p-6">
        {block.block ? (
          <pre tabIndex={0} aria-label="The memory block of the prompt" className="relative max-h-96 overflow-auto rounded-lg border border-border/70 bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {block.block.trim()}
          </pre>
        ) : (
          <p className="rounded-lg border border-border/70 bg-muted/50 p-4 text-sm text-muted-foreground">Nothing is added to the prompt.</p>
        )}
      </div>
    </section>
  );
}
