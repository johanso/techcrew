"use client";

import { Fragment, useEffect, useState } from "react";
import { format, formatDistanceStrict, formatDistanceToNowStrict } from "date-fns";
import {
  BookmarkPlusIcon,
  BookOpenTextIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileCheckIcon,
  FileDiffIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FileWarningIcon,
  FileXIcon,
  FlaskConicalIcon,
  FolderTreeIcon,
  GitMergeIcon,
  GlobeIcon,
  HammerIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  MessageCircleReplyIcon,
  RouteIcon,
  ScrollTextIcon,
  SearchIcon,
  SquareTerminalIcon,
  TextSearchIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { getRunLogAction } from "@/app/dashboard/[workspaceId]/board/actions";
import { AgentPortrait } from "@/components/ai-team/agent-visuals";
import { AgentRunStatus } from "@/components/board/agent-run-status";
import { RememberDialog, type RememberTarget } from "@/components/brain/remember-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ROLES, formatMicros } from "@/lib/agent-config";
import { STAGE_META, TOOL_LABEL, isActiveRun } from "@/lib/agent-run-config";
import type { RunLog, RunLogStage, RunLogStep } from "@/lib/agent-runs";

type RunLogEnd = NonNullable<RunLogStage["end"]>;
import type { BoardCard } from "@/lib/board-config";
import { ciForRound, ciSummary, type CiResult, type CiState } from "@/lib/ci-gate";
import { stepRememberText } from "@/lib/memory-signals";
import { cn } from "@/lib/utils";

// While the agents work, the log follows them.
const POLL_MS = 5_000;

/** How a stage's end reads: done, waiting on the owner's answer, or stopped. */
const STAGE_END: Record<RunLogEnd["kind"], { icon: LucideIcon; tone: string; box: string }> = {
  result: { icon: CircleCheckIcon, tone: "text-success", box: "bg-success/8 ring-success/25" },
  question: { icon: MessageCircleQuestionIcon, tone: "text-warning", box: "bg-warning/8 ring-warning/25" },
  stopped: { icon: CircleAlertIcon, tone: "text-error", box: "bg-error/6 ring-error/20" },
};

/** How each tool reads in the log: "Read src/app.ts", "Edited README.md" … (labels shared with the live process). */
const TOOL_ICON: Record<string, LucideIcon> = {
  list_files: FolderTreeIcon,
  read_file: FileTextIcon,
  search_code: SearchIcon,
  write_file: FilePlusIcon,
  replace_in_file: FilePenIcon,
  delete_file: FileXIcon,
  get_diff: FileDiffIcon,
  get_checks: ListChecksIcon,
  search_skill: TextSearchIcon,
  read_skill: BookOpenTextIcon,
  run_tests: FlaskConicalIcon,
  run_build: HammerIcon,
  run_command: SquareTerminalIcon,
  browse_preview: GlobeIcon,
  merge_default_branch: GitMergeIcon,
  read_conflict: FileWarningIcon,
  resolve_conflict: FileCheckIcon,
  finish_merge: GitMergeIcon,
  route: RouteIcon,
};

// Tools whose outcome line is worth reading even when it went well ("Opened /: 200, 0 console errors …"); `route` says
// why a stage took the API key although the owner's plan is on.
const SHOW_SUMMARY = new Set(["browse_preview", "merge_default_branch", "finish_merge", "route"]);

/** An entry of the log the owner can ask the Brain to remember: its row id and the text the dialog starts with. */
type OnRemember = (entry: { stepId: number; text: string }) => void;

function RememberButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={`Remember this: ${label}`}
      title="Remember this"
      className={cn("size-6 shrink-0 text-muted-foreground hover:bg-muted hover:text-brand-emphasis", className)}
    >
      <BookmarkPlusIcon />
    </Button>
  );
}

function Step({ step, runId, onRemember }: { step: RunLogStep; runId: number; onRemember: OnRemember }) {
  const meta = { label: TOOL_LABEL[step.tool] ?? step.tool, icon: TOOL_ICON[step.tool] ?? WrenchIcon };
  const screenshot = `/api/runs/${runId}/steps/${step.id}/screenshot`;
  return (
    <li className="flex min-w-0 gap-2.5 py-1.5">
      <meta.icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", step.ok ? "text-muted-foreground" : "text-error")} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="shrink-0 font-medium">{meta.label}</span>
          {step.target && <span className="min-w-0 truncate font-mono text-muted-foreground">{step.target}</span>}
          {!step.ok && <span className="sr-only">(failed)</span>}
        </p>
        {/* Errors matter to the user; confirmations of writes are noise next to the file name. */}
        {!step.ok && step.summary && <p className="line-clamp-2 text-xs text-error">{step.summary}</p>}
        {step.ok && step.summary && SHOW_SUMMARY.has(step.tool) && <p className="line-clamp-2 text-xs text-muted-foreground">{step.summary}</p>}
        {step.screenshot && (
          <a
            href={screenshot}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block w-44 max-w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border/70 transition-colors outline-none hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated route; next/image can't optimize it */}
            <img
              src={screenshot}
              alt={`Screenshot of the preview at ${step.target ?? "/"}`}
              loading="lazy"
              className="aspect-8/5 w-full object-cover object-top"
            />
            <span className="sr-only"> (opens the full screenshot in a new tab)</span>
          </a>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={`Turn ${step.turn}`}>
        T{step.turn}
      </span>
      <RememberButton
        label={[meta.label, step.target].filter(Boolean).join(" ")}
        onClick={() => onRemember({ stepId: step.id, text: stepRememberText(step) })}
        className="-mt-1"
      />
    </li>
  );
}

function StageBlock({ stage, live, runId, onRemember }: { stage: RunLogStage; live: boolean; runId: number; onRemember: OnRemember }) {
  const role = AGENT_ROLES[stage.agent];
  const end = stage.end ? STAGE_END[stage.end.kind] : null;
  return (
    <section className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <AgentPortrait agent={role} size="sm" working={live} alt={role.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-bold">
            {STAGE_META[stage.stage].label}
            {stage.round > 0 && <span className="font-medium text-muted-foreground"> · rework {stage.round}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {role.name}
            {stage.modelLabel && ` · ${stage.modelLabel}`}
            {stage.turns > 0 && ` · ${stage.turns} turn${stage.turns === 1 ? "" : "s"}`}
          </p>
        </div>
        {stage.costMicros > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-border/70">
            {formatMicros(stage.costMicros)}
          </span>
        )}
      </div>

      {end && stage.end ? (
        <div className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs ring-1", end.box)}>
          <end.icon aria-hidden className={cn("mt-px size-3.5 shrink-0", end.tone)} />
          <p className="line-clamp-4 min-w-0 flex-1 wrap-anywhere">{stage.end.summary}</p>
          {stage.end.summary && (
            <RememberButton
              label={`how ${STAGE_META[stage.stage].label.toLowerCase()} ended`}
              onClick={() => stage.end && onRemember({ stepId: stage.end.id, text: stepRememberText({ tool: "result", target: null, summary: stage.end.summary }) })}
              className="-my-1 -mr-1.5"
            />
          )}
        </div>
      ) : (
        live && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin text-action" />
            {role.name} is working…
          </p>
        )
      )}

      {stage.filesChanged.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="eyebrow text-muted-foreground">Files changed</p>
          <ul className="flex flex-wrap gap-1.5">
            {stage.filesChanged.map((file) => (
              <li key={file} className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-border/70">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage.steps.length > 0 && (
        <details className="group" open={live}>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
            {stage.steps.length} tool call{stage.steps.length === 1 ? "" : "s"}
            {stage.steps.some((s) => !s.ok) && ` · ${stage.steps.filter((s) => !s.ok).length} failed`}
          </summary>
          <ol className="mt-1 flex flex-col">
            {stage.steps.map((step) => (
              <Step key={step.id} step={step} runId={runId} onRemember={onRemember} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

const CI_END: Record<CiState, { icon: LucideIcon; tone: string; box: string; spin?: boolean }> = {
  waiting: { icon: LoaderCircleIcon, tone: "text-action", box: "bg-muted/60 ring-border/70", spin: true },
  passed: STAGE_END.result,
  failed: STAGE_END.stopped,
  none: { icon: ListChecksIcon, tone: "text-muted-foreground", box: "bg-muted/60 ring-border/70" },
  timed_out: { icon: ClockIcon, tone: "text-warning", box: "bg-warning/8 ring-warning/25" },
};

/** The CI gate after a development round: what the checks said on the pushed commit, and links to the failures. */
function CiBlock({ ci }: { ci: CiResult }) {
  const end = CI_END[ci.state];
  return (
    <section className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="icon-tile size-9 rounded-full text-brand-emphasis">
          <ListChecksIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-bold">
            CI checks
            {ci.round > 0 && <span className="font-medium text-muted-foreground"> · rework {ci.round}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Automatic · <span className="font-mono">{ci.sha.slice(0, 7)}</span>
          </p>
        </div>
      </div>
      <p className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs ring-1", end.box)}>
        <end.icon aria-hidden className={cn("mt-px size-3.5 shrink-0", end.tone, end.spin && "motion-safe:animate-spin")} />
        <span className="line-clamp-4">{ciSummary(ci)}</span>
      </p>
      {ci.failing.length > 0 && (
        <ul className="flex flex-col gap-1">
          {ci.failing.map((check) => (
            <li key={check.name} className="flex min-w-0 items-center gap-2 text-xs">
              <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-error" />
              <span className="min-w-0 truncate font-medium">{check.name}</span>
              <span className="shrink-0 text-muted-foreground">{check.conclusion}</span>
              {check.url && (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-brand-emphasis hover:underline"
                >
                  Open
                  <ExternalLinkIcon aria-hidden className="size-3" />
                  <span className="sr-only">{check.name} on GitHub</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the agents did on a card's latest run, stage by stage: who worked, on which model, the tools they used, the
 * files they changed and how each stage ended. Opened from the card's ⋯ menu or a notification (?log=<card>).
 */
export function RunLogSheet({
  workspaceId,
  memoryOff,
  card,
  onOpenChange,
  onAnswer,
}: {
  workspaceId: number;
  /** The project's memory is off ("Remember this" says so). */
  memoryOff: boolean;
  card: BoardCard | null;
  onOpenChange: (open: boolean) => void;
  /** Opens the answer dialog for a card whose analyst waits on a question. */
  onAnswer: (card: BoardCard) => void;
}) {
  const [log, setLog] = useState<{ cardId: string; data: RunLog | null } | null>(null);
  const [rememberTarget, setRememberTarget] = useState<RememberTarget | null>(null);
  const cardId = card?.id ?? null;
  const live = card?.run ? isActiveRun(card.run.status) : false;

  useEffect(() => {
    if (!cardId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const data = await getRunLogAction(workspaceId, cardId).catch(() => null);
      if (cancelled) return;
      setLog({ cardId, data });
      if (data && isActiveRun(data.run.status)) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `live` restarts polling when the board sees a new run start on this card.
  }, [workspaceId, cardId, live]);

  const data = log?.cardId === cardId ? log.data : undefined;
  const run = data?.run;

  return (
    <Sheet
      open={card !== null}
      onOpenChange={(open) => {
        // A note left open doesn't come back the next time the log opens.
        if (!open) setRememberTarget(null);
        onOpenChange(open);
      }}
    >
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <div className="flex items-start gap-3 border-b border-border/70 px-5 py-4 pr-12">
          <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
            <ScrollTextIcon />
          </span>
          <div className="flex min-w-0 flex-col">
            <SheetTitle className="truncate text-base font-bold">Agent log · {card?.key}</SheetTitle>
            <SheetDescription className="line-clamp-2 text-xs">{card?.title}</SheetDescription>
          </div>
        </div>

        {card?.run && <AgentRunStatus run={card.run} className="mx-5 mt-4" />}
        {card?.run?.status === "needs_info" && (
          <Button variant="outline" className="mx-5 mt-2.5 h-9 self-start" onClick={() => onAnswer(card)}>
            <MessageCircleReplyIcon />
            Answer the analyst
          </Button>
        )}

        {run && (
          <dl className="mx-5 mt-4 grid grid-cols-3 overflow-hidden rounded-lg bg-canvas ring-1 ring-border/70">
            {[
              { label: "Started", value: formatDistanceToNowStrict(run.startedAt, { addSuffix: true }), title: format(run.startedAt, "PPpp") },
              {
                label: run.finishedAt ? "Took" : "Running for",
                value: formatDistanceStrict(run.finishedAt ?? new Date(), run.startedAt),
                title: undefined,
              },
              // Stages on the owner's plan add nothing here: their usage is in each stage's result line.
              { label: "API spend", value: formatMicros(run.costMicros), title: undefined },
            ].map((item) => (
              <div key={item.label} className="flex min-w-0 flex-col gap-0.5 border-r border-border/70 px-3 py-2.5 last:border-r-0">
                <dt className="truncate text-[11px] font-medium text-muted-foreground">{item.label}</dt>
                <dd className="truncate text-sm font-bold tabular-nums" title={item.title}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-border/70">
          {data === undefined ? (
            <div className="flex flex-col gap-3 p-5">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !data || data.stages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="icon-tile text-brand-emphasis">
                <ScrollTextIcon />
              </span>
              <p className="text-sm font-semibold">{data && isActiveRun(data.run.status) ? "Getting started…" : "Nothing logged for this run"}</p>
              <p className="max-w-64 text-xs text-muted-foreground">
                {data && isActiveRun(data.run.status)
                  ? "The analyst's first steps show up here in a few seconds."
                  : "Runs from before the agent log, or ones that stopped before any agent worked, have no steps."}
              </p>
            </div>
          ) : (
            data.stages.map((stage) => {
              const ci = stage.stage === "development" ? ciForRound(data.ci, stage.round) : null;
              return (
                <Fragment key={`${stage.stage}-${stage.round}`}>
                  <StageBlock
                    stage={stage}
                    runId={data.run.id}
                    // Everything in the log is an agent's words, so saved unchanged it stays untrusted.
                    onRemember={(entry) => card && setRememberTarget({ cardId: card.id, cardKey: card.key, ...entry, someoneElses: true })}
                    // Two blocks can be live at once: Reviewer and Security work the review phase in parallel.
                    live={
                      isActiveRun(data.run.status) &&
                      !stage.end &&
                      data.run.stage === STAGE_META[stage.stage].phase &&
                      data.run.reworkRounds === stage.round
                    }
                  />
                  {ci && <CiBlock ci={ci} />}
                </Fragment>
              );
            })
          )}
        </div>
        {/* Inside the sheet, so it opens over the log and closing it returns there. */}
        <RememberDialog workspaceId={workspaceId} memoryOff={memoryOff} target={rememberTarget} onClose={() => setRememberTarget(null)} />
      </SheetContent>
    </Sheet>
  );
}
