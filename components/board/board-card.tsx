"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { CalendarIcon, CalendarX2Icon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { IssueTypePill, PriorityBadge } from "@/components/board/issue-meta";
import { AgentAvatar } from "@/components/dashboard/agent-avatar";
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
      <div className="flex items-center justify-between gap-2">
        <IssueTypePill type={card.type} />
        {card.github ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums"
            title={`GitHub issue #${card.github.number} · ${card.key}`}
          >
            <GitHubIcon className="size-3" />#{card.github.number}
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">{card.key}</span>
        )}
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
          {card.dueDate && <DueDate date={card.dueDate} done={done} />}
          {card.assignee && <AgentAvatar agent={card.assignee} className="size-6 text-[10px]" />}
        </div>
      </div>
    </article>
  );
}

/**
 * Draggable card inside a column. While dragging, it stays in place as a faded placeholder.
 * Click or Enter opens its details; Space (keyboard) and a 6 px pointer move start a drag.
 */
export function SortableBoardCard({
  card,
  done,
  highlight,
  onOpen,
}: {
  card: BoardCard;
  done: boolean;
  highlight: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });

  return (
    <BoardCardView
      ref={setNodeRef}
      card={card}
      done={done}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "opacity-40",
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
  );
}
