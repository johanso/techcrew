"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { CalendarIcon, CalendarX2Icon, EllipsisIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { IssueTypePill, PriorityBadge } from "@/components/board/issue-meta";
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
import type { BoardCard } from "@/lib/board-config";
import { cn } from "@/lib/utils";

function DueDate({ date, done }: { date: string; done: boolean }) {
  const days = differenceInCalendarDays(parseISO(date), new Date());
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : format(parseISO(date), "MMM d");
  const overdue = days < 0 && !done;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        overdue ? "font-semibold text-error" : days <= 1 && !done && "font-semibold text-foreground"
      )}
      title={overdue ? `Overdue since ${format(parseISO(date), "MMM d")}` : "Due date"}
    >
      {overdue ? <CalendarX2Icon className="size-3.5" /> : <CalendarIcon className="size-3.5" />}
      {overdue && <span className="sr-only">Overdue:</span>}
      {label}
    </span>
  );
}

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

/** Run (▶) and the ⋯ menu. Rendered beside the card, not inside it, so they never start a drag or open it. */
function CardActions({
  card,
  running,
  onRun,
  onRemove,
}: {
  card: BoardCard;
  running: boolean;
  onRun: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRun}
              disabled={running}
              aria-label={running ? `Starting the analyst on ${card.key}` : `Run ${card.key}: assign it to the analyst`}
              className="text-muted-foreground hover:bg-muted hover:text-brand-emphasis"
            />
          }
        >
          {running ? <Spinner /> : <PlayIcon />}
        </TooltipTrigger>
        <TooltipContent>{card.assignee ? `Run again with ${card.assignee.name}` : "Run: assign to the analyst"}</TooltipContent>
      </Tooltip>
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
        <DropdownMenuContent align="end" sideOffset={4} className="w-44">
          <DropdownMenuItem onClick={onRun} disabled={running} className="gap-2 py-1.5">
            <PlayIcon />
            Run
          </DropdownMenuItem>
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
  onOpen,
  onRun,
  onRemove,
}: {
  card: BoardCard;
  done: boolean;
  highlight: boolean;
  running: boolean;
  onOpen: () => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

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
      {!isDragging && <CardActions card={card} running={running} onRun={onRun} onRemove={onRemove} />}
    </div>
  );
}
