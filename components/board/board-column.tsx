"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "lucide-react";

import { SortableBoardCard } from "@/components/board/board-card";
import { COLUMN_STYLE } from "@/components/board/issue-meta";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BOARD_COLUMNS, BoardCard } from "@/lib/board-config";
import { cn } from "@/lib/utils";

export function BoardColumn({
  column,
  cards,
  hiddenCount,
  expanded,
  onToggleExpanded,
  totalCount,
  filtering,
  highlightId,
  runningIds,
  mergingIds,
  onAdd,
  onOpenCard,
  onRunCard,
  onStopCard,
  onMergeCard,
  onAnswerCard,
  onViewLog,
  onRememberCard,
  onRemoveCard,
  workspaceId,
  onRejectionResolved,
}: {
  column: (typeof BOARD_COLUMNS)[number];
  /** Cards to render (already filtered, and cut to the preview while the column is collapsed). */
  cards: BoardCard[];
  /** Cards left out of the collapsed preview: "Show N more". */
  hiddenCount: number;
  /** Opened with "Show more" and long enough to offer "Show less". */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** All cards in the column, ignoring filters. */
  totalCount: number;
  filtering: boolean;
  highlightId: string | null;
  /** Cards whose Run is being started. */
  runningIds: ReadonlySet<string>;
  /** Cards whose pull request is being merged. */
  mergingIds: ReadonlySet<string>;
  onAdd: () => void;
  onOpenCard: (card: BoardCard) => void;
  onRunCard: (card: BoardCard) => void;
  onStopCard: (card: BoardCard) => void;
  onMergeCard: (card: BoardCard) => void;
  onAnswerCard: (card: BoardCard) => void;
  onViewLog: (card: BoardCard) => void;
  onRememberCard: (card: BoardCard) => void;
  onRemoveCard: (card: BoardCard) => void;
  workspaceId: number;
  /** A card's "Why was this rejected?" was answered or dismissed. */
  onRejectionResolved: (card: BoardCard) => void;
}) {
  // The column itself is a drop target, so empty columns accept cards too.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const style = COLUMN_STYLE[column.id];
  const listId = `board-column-${column.id}`;

  return (
    <section
      aria-label={column.title}
      className={cn(
        "flex min-h-0 w-[17rem] shrink-0 snap-start flex-col rounded-xl ring-1 transition-shadow xl:w-auto xl:min-w-60 xl:flex-1",
        style.tint,
        isOver ? cn("ring-2", style.over) : style.ring
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-3">
        <span aria-hidden className={cn("size-2 rounded-full", style.dot)} />
        <h2 className="truncate text-sm font-bold">{column.title}</h2>
        <span
          className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums ring-1 ring-border/70"
          aria-label={filtering ? `${cards.length} of ${totalCount} cards match` : `${totalCount} cards`}
        >
          {filtering ? `${cards.length}/${totalCount}` : totalCount}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onAdd}
                aria-label={`Add a card to ${column.title}`}
                className="ml-auto text-muted-foreground hover:bg-card hover:text-foreground"
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>Add to {column.title}</TooltipContent>
        </Tooltip>
      </header>

      <SortableContext id={column.id} items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        {/* The column's own scroll: its header and count stay put. dnd-kit scrolls it while a card is dragged near an edge. */}
        <div
          ref={setNodeRef}
          id={listId}
          className="flex min-h-32 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-2.5 pb-2.5 [scrollbar-width:thin]"
        >
          {cards.map((card) => (
            <SortableBoardCard
              key={card.id}
              card={card}
              done={column.id === "done"}
              highlight={card.id === highlightId}
              running={runningIds.has(card.id)}
              merging={mergingIds.has(card.id)}
              onOpen={() => onOpenCard(card)}
              onRun={() => onRunCard(card)}
              onStop={() => onStopCard(card)}
              onMerge={() => onMergeCard(card)}
              onAnswer={() => onAnswerCard(card)}
              onViewLog={() => onViewLog(card)}
              onRemember={() => onRememberCard(card)}
              onRemove={() => onRemoveCard(card)}
              workspaceId={workspaceId}
              onRejectionResolved={() => onRejectionResolved(card)}
            />
          ))}
          {cards.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg bg-card/50 p-4 text-center text-xs text-muted-foreground ring-1 ring-border/60 ring-inset">
              {filtering && totalCount > 0 ? "No matching cards." : `${column.hint}. Drop a card here.`}
            </div>
          )}
          {(hiddenCount > 0 || expanded) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              aria-controls={listId}
              className="h-8 shrink-0 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
            >
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {expanded ? "Show less" : `Show ${hiddenCount} more`}
            </Button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
