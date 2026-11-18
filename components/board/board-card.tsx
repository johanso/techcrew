"use client";

import { useEffect } from "react";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CircleCheckIcon,
  CircleStopIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  MessageCircleReplyIcon,
  PlayIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { AgentRunStatus } from "@/components/board/agent-run-status";
import { DueDate, IssueTypePill, PriorityBadge } from "@/components/board/issue-meta";
import { AgentAvatar } from "@/components/dashboard/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActiveRun } from "@/lib/agent-run-config";
import type { BoardCard } from "@/lib/board-config";
import { cn } from "@/lib/utils";

/** Visual card. Also rendered inside the DragOverlay, so it must not use dnd hooks. */
export function BoardCardView({
  card,
  done = false,
  className,
  ...props
}: { card: BoardCard; done?: boolean } & React.ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "surface relative flex flex-col gap-3 p-3.5 text-left transition-colors outline-none select-none",
        "hover:border-brand/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
        className
      )}
      {...props}
    >
      {/* pr-16 leaves room for the Run / ⋯ buttons, which sit on top of the card (see SortableBoardCard). */}
      <div className="flex min-w-0 items-center gap-2 pr-16">
        <IssueTypePill type={card.type} />
        <span className="truncate text-xs font-semibold text-muted-foreground tabular-nums">{card.key}</span>
      </div>

      <p className="line-clamp-3 text-sm leading-snug font-semibold">{card.title}</p>

      {card.run && <AgentRunStatus run={card.run} />}

      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <span key={label} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border/70">
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <PriorityBadge priority={card.priority} />
        <div className="flex min-w-0 items-center gap-2.5">
          {card.github && (
            <span className="inline-flex items-center gap-1 font-medium tabular-nums" title={`GitHub issue #${card.github.number}`}>
              <GitHubIcon className="size-3" />#{card.github.number}
            </span>
          )}
          {card.dueDate && <DueDate date={card.dueDate} done={done} />}
          {card.assignee && <AgentAvatar agent={card.assignee} className="size-6 text-[10px]" />}
        </div>
      </div>
    </article>
  );
}

/**
 * Run (▶) — or Merge, when the card's pull request waits for a manual merge, Answer, when the analyst waits on a
 * question, or a check in Done — and the ⋯ menu
 * (which keeps Run, for the rare rerun of a finished card). Rendered beside the card, not inside it, so they never
 * start a drag or open it.
 */
function CardActions({
  card,
  done,
  running,
  merging,
  onRun,
  onStop,
  onMerge,
  onAnswer,
  onViewLog,
  onRemove,
}: {
  card: BoardCard;
  done: boolean;
  running: boolean;
  merging: boolean;
  onRun: () => void;
  onStop: () => void;
  onMerge: () => void;
  onAnswer: () => void;
  onViewLog: () => void;
  onRemove: () => void;
}) {
  // The agents are on it: Run would start a second pass, so it waits until the run ends (or is stopped).
  const working = card.run !== null && isActiveRun(card.run.status);
  const runLabel = working ? `Agents are working on ${card.key}` : running ? `Starting the agents on ${card.key}` : `Run ${card.key}: start the agents`;
  const pullRequest = card.run?.status === "awaiting_merge" ? card.run.pullRequest : null;
  const needsInfo = card.run?.status === "needs_info";
  return (
    <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5">
      {pullRequest ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onMerge}
                disabled={merging}
                aria-label={merging ? `Merging PR #${pullRequest.number}` : `Merge PR #${pullRequest.number} of ${card.key}`}
                className="text-success hover:bg-success/10 hover:text-success"
              />
            }
          >
            {merging ? <Spinner /> : <GitMergeIcon />}
          </TooltipTrigger>
          <TooltipContent>Merge PR #{pullRequest.number}</TooltipContent>
        </Tooltip>
      ) : needsInfo ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onAnswer}
                disabled={running}
                aria-label={`Answer the analyst's question on ${card.key}`}
                className="text-warning hover:bg-warning/10 hover:text-warning"
              />
            }
          >
            {running ? <Spinner /> : <MessageCircleReplyIcon />}
          </TooltipTrigger>
          <TooltipContent>Answer the analyst</TooltipContent>
        </Tooltip>
      ) : done && !working ? (
        // A status, not an action: the column and the run line already say how it got here.
        <span className="flex size-7 items-center justify-center text-success" title="Done">
          <CircleCheckIcon aria-hidden className="size-4" />
          <span className="sr-only">{card.key} is done</span>
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRun}
                disabled={running || working}
                aria-label={runLabel}
                className="text-muted-foreground hover:bg-muted hover:text-brand-emphasis"
              />
            }
          >
            {running || working ? <Spinner /> : <PlayIcon />}
          </TooltipTrigger>
          <TooltipContent>{working ? "Agents are working on it" : card.run ? "Run the agents again" : "Run: the analyst picks it up"}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${card.key}`}
              className="text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-48">
          {pullRequest && (
            <>
              <DropdownMenuItem onClick={onMerge} disabled={merging} className="gap-2 py-1.5">
                <GitMergeIcon />
                Merge PR #{pullRequest.number}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<a href={pullRequest.url} target="_blank" rel="noopener noreferrer" />}
                className="gap-2 py-1.5"
              >
                <ExternalLinkIcon />
                View PR on GitHub
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {needsInfo && (
            <DropdownMenuItem onClick={onAnswer} className="gap-2 py-1.5">
              <MessageCircleReplyIcon />
              Answer the analyst
            </DropdownMenuItem>
          )}
          {working ? (
            <DropdownMenuItem onClick={onStop} className="gap-2 py-1.5">
              <CircleStopIcon />
              Stop agents
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onRun} disabled={running} className="gap-2 py-1.5">
              <PlayIcon />
              {/* A rerun continues on the same branch and pull request (runCardAction). */}
              {card.run?.pullRequest ? `Run again on PR #${card.run.pullRequest.number}` : card.run ? "Run again" : "Run"}
            </DropdownMenuItem>
          )}
          {card.run && (
            <DropdownMenuItem onClick={onViewLog} className="gap-2 py-1.5">
              <ScrollTextIcon />
              View agent log
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRemove} className="gap-2 py-1.5">
            <Trash2Icon />
            Remove task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Draggable card inside a column. While dragging, it stays in place as a faded placeholder.
 * Click or Enter opens its details; Space (keyboard) and a 6 px pointer move start a drag.
 * The wrapper is what moves; only the card itself (the activator) picks it up.
 */
export function SortableBoardCard({
  card,
  done,
  highlight,
  running,
  merging,
  onOpen,
  onRun,
  onStop,
  onMerge,
  onAnswer,
  onViewLog,
  onRemove,
}: {
  card: BoardCard;
  done: boolean;
  highlight: boolean;
  running: boolean;
  merging: boolean;
  onOpen: () => void;
  onRun: () => void;
  onStop: () => void;
  onMerge: () => void;
  onAnswer: () => void;
  onViewLog: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, node } = useSortable({
    id: card.id,
  });
  // A card just created or saved may sit below its column's scroll: bring it into view.
  useEffect(() => {
    if (highlight) node.current?.scrollIntoView({ block: "nearest" });
  }, [highlight, node]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative min-w-0", isDragging && "opacity-40")}
    >
      <BoardCardView
        ref={setActivatorNodeRef}
        card={card}
        done={done}
        className={cn(
          "cursor-grab touch-manipulation active:cursor-grabbing",
          highlight && "animate-in fade-in zoom-in-95 border-brand/40 duration-300"
        )}
        {...attributes}
        {...listeners}
        onClick={onOpen}
        onKeyDown={(event) => {
          listeners?.onKeyDown?.(event);
          if (event.key === "Enter" && !event.defaultPrevented && !isDragging) {
            event.preventDefault();
            onOpen();
          }
        }}
        aria-roledescription="Draggable card"
        aria-label={`${card.key}: ${card.title}`}
      />
      {!isDragging && (
        <CardActions
          card={card}
          done={done}
          running={running}
          merging={merging}
          onRun={onRun}
          onStop={onStop}
          onMerge={onMerge}
          onAnswer={onAnswer}
          onViewLog={onViewLog}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}
