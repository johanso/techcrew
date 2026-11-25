import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { BanIcon, BotIcon, ChevronDownIcon, CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon, HistoryIcon, UserCheckIcon } from "lucide-react";

import { SignalDeleteButton } from "@/components/brain/signal-delete-button";
import { SIGNAL_ICON } from "@/components/brain/signal-icons";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { Pill } from "@/components/skills/skill-badges";
import { buttonVariants } from "@/components/ui/button";
import { MEMORY_TYPE_META } from "@/lib/memory-config";
import { REJECTION_REASON_LABEL, REWORK_CAUSE_LABEL, SIGNAL_KIND_LABEL, SIGNAL_SCOPE_LABEL } from "@/lib/memory-signals";
import type { SignalView } from "@/lib/memory-signals-store";
import { cn } from "@/lib/utils";

/** The line above a signal's text: the reason, the cause, the lesson's title or where a note applies. */
function heading({ kind, payload }: SignalView) {
  if (kind === "pr_rejected") return payload.reason ? REJECTION_REASON_LABEL[payload.reason] : null;
  if (kind === "rework") return payload.cause ? `${REWORK_CAUSE_LABEL[payload.cause]} (round ${(payload.round ?? 0) + 1})` : null;
  if (kind === "lesson") return payload.title ?? null;
  if (kind === "remember") return payload.scope ? `Applies to: ${SIGNAL_SCOPE_LABEL[payload.scope].toLowerCase()}` : null;
  return null;
}

function SignalRow({ workspaceId, signal }: { workspaceId: number; signal: SignalView }) {
  const meta = SIGNAL_ICON[signal.kind];
  const label = SIGNAL_KIND_LABEL[signal.kind];
  const { payload, card, pullRequest } = signal;
  const title = heading(signal);
  const summary = title || payload.text || label;
  return (
    // A proposal's evidence links here.
    <li id={`signal-${signal.id}`} className="flex min-w-0 scroll-mt-20 gap-3 p-4 target:bg-brand/5 sm:gap-4 sm:p-6">
      <span className={cn("icon-tile size-9 shrink-0 rounded-lg [&_svg]:size-4.5", meta.tone)}>
        <meta.icon aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-bold">{label}</h3>
            {signal.trusted ? (
              <Pill className="bg-success/10 text-foreground ring-success/30" title="You typed this in TechTeam.">
                <UserCheckIcon aria-hidden className="size-3" />
                Trusted
              </Pill>
            ) : (
              <Pill title="Not typed by you: written by an agent, CI or GitHub. Treated as untrusted.">
                <BotIcon aria-hidden className="size-3" />
                From an agent
              </Pill>
            )}
            {payload.type && <Pill>{MEMORY_TYPE_META[payload.type].label}</Pill>}
          </div>
          <SignalDeleteButton workspaceId={workspaceId} signalId={signal.id} label={`${label}: ${summary.slice(0, 80)}`} />
        </div>
        {title && <p className="text-sm font-medium wrap-anywhere">{title}</p>}
        {payload.context && (
          <p className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
            <span className="font-medium">Asked:</span> {payload.context}
          </p>
        )}
        {payload.text && <p className="line-clamp-3 text-sm wrap-anywhere whitespace-pre-line text-foreground/80">{payload.text}</p>}
        {payload.evidence && (
          <p className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
            <span className="font-medium">Evidence:</span> {payload.evidence}
          </p>
        )}
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {card &&
            (card.removed ? (
              <span title={card.title}>{card.key} (removed)</span>
            ) : (
              <Link href={`/dashboard/${workspaceId}/board?log=${card.id}`} title={card.title} className="font-medium text-foreground hover:underline">
                {card.key}
              </Link>
            ))}
          {pullRequest &&
            (pullRequest.url ? (
              <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums hover:underline">
                PR #{pullRequest.number}
                <ExternalLinkIcon aria-hidden className="size-3" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="tabular-nums">PR #{pullRequest.number}</span>
            ))}
          <span className="inline-flex items-center gap-1">
            {signal.consumedAt ? <CircleCheckIcon aria-hidden className="size-3.5 text-success" /> : <CircleDashedIcon aria-hidden className="size-3.5" />}
            {signal.consumedAt ? "Used" : "Not used yet"}
          </span>
          <time dateTime={signal.createdAt.toISOString()} title={format(signal.createdAt, "PPpp")}>
            {formatDistanceToNowStrict(signal.createdAt, { addSuffix: true })}
          </time>
        </p>
      </div>
    </li>
  );
}

/**
 * Brain → Activity: what has been collected to learn from, newest first. `olderHref` links to a longer list; `paused`
 * while memory is off (what was collected stays listed).
 */
export function SignalActivity({ workspaceId, signals, olderHref, paused }: { workspaceId: number; signals: SignalView[]; olderHref: string | null; paused: boolean }) {
  return (
    <section id="activity" className="surface flex min-w-0 flex-col" aria-label="Activity">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <HistoryIcon />
          </span>
        }
        title="Activity"
        description="What the Brain has collected to learn from. Agents don't read this list."
      />
      {paused && (
        <p className="flex items-start gap-2 border-b border-border/70 bg-muted/60 px-6 py-3 text-sm">
          <BanIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          Collection is paused while memory is off. Only what you save with “Remember this” is added.
        </p>
      )}
      {signals.length ? (
        <ul className="flex flex-col divide-y divide-border/70">
          {signals.map((signal) => (
            <SignalRow key={signal.id} workspaceId={workspaceId} signal={signal} />
          ))}
        </ul>
      ) : (
        <SurfaceEmpty
          icon={HistoryIcon}
          title="Nothing collected yet"
          description="Rejected pull requests, rework rounds, your answers, the Lead's lessons and what you ask to remember show up here."
        />
      )}
      {olderHref && (
        <div className="flex justify-center border-t border-border/70 p-4">
          <Link href={olderHref} scroll={false} className={buttonVariants({ variant: "outline", className: "h-9" })}>
            Show more
            <ChevronDownIcon data-icon="inline-end" />
          </Link>
        </div>
      )}
    </section>
  );
}
