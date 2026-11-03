"use client";

import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ChevronDownIcon, CircleAlertIcon, PlusIcon } from "lucide-react";

import {
  createCardAction,
  moveCardsAction,
  removeCardAction,
  mergeCardAction,
  runCardAction,
  stopCardAction,
  updateCardAction,
} from "@/app/dashboard/[workspaceId]/board/actions";
import { BoardCardView } from "@/components/board/board-card";
import { BoardColumn } from "@/components/board/board-column";
import { isFiltering, matchesFilters, matchesQuery, NO_FILTERS, type BoardFilters, type TypeFilter } from "@/components/board/board-filters";
import { BoardToolbar } from "@/components/board/board-toolbar";
import { CardDialog, type CardDialogMode, type CardDialogSubmit } from "@/components/board/card-dialog";
import { GithubSyncButton, GithubSyncNotice } from "@/components/board/github-sync-controls";
import { useGithubSync } from "@/components/board/use-github-sync";
import { ISSUE_TYPE_META } from "@/components/board/issue-meta";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  BOARD_COLUMNS,
  ISSUE_TYPES,
  isBoardColumnId,
  type BoardCard,
  type BoardColumnId,
  type BoardColumns,
  type BoardData,
} from "@/lib/board-config";
import { isActiveRun } from "@/lib/agent-run-config";
import { cn } from "@/lib/utils";

const COLUMN_TITLE = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, c.title])) as Record<BoardColumnId, string>;

export function KanbanBoard({
  workspaceId,
  initial,
  repo,
  lastSyncedAt,
}: {
  workspaceId: number;
  initial: BoardData;
  repo: string;
  /** Last GitHub issue sync (ISO), or null if this workspace never synced. */
  lastSyncedAt: string | null;
}) {
  const [cards, setCards] = useState(initial.cards);
  const [columns, setColumns] = useState<BoardColumns>(initial.columns);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  // The overlay copies the picked-up card's width, since columns are fluid on wide screens.
  const [overlayWidth, setOverlayWidth] = useState<number | undefined>(undefined);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  // Typing stays responsive while the columns re-filter in the background.
  const deferredFilters = useDeferredValue(filters);
  const [dialog, setDialog] = useState<{ open: boolean; mode: CardDialogMode }>({
    open: false,
    mode: { kind: "create", type: "feature", status: "todo" },
  });
  const [boardError, setBoardError] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [mergingIds, setMergingIds] = useState<ReadonlySet<string>>(new Set());
  // The card the remove confirmation is about; kept while the dialog animates out.
  const [removal, setRemoval] = useState<{ open: boolean; card: BoardCard | null; pending: boolean }>({
    open: false,
    card: null,
    pending: false,
  });
  // Column layout when the drag began: restored on Escape, and if saving the move fails.
  const snapshot = useRef<BoardColumns | null>(null);
  // A pointer drag that ends on its own card would also fire a click; ignore clicks right after a drop.
  const lastDropAt = useRef(0);
  // Latest columns for the keyboard sensor, which keeps the options it was created with for the whole drag.
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  // Stable id keeps dnd-kit's generated aria-describedby ids identical on server and client.
  const dndId = useId();

  // A synced board must not land mid-drag or before a move/removal is saved: it would undo it on screen.
  const dragging = useRef(false);
  const pendingWrites = useRef(0);
  // While agents work on any card, poll faster and always take the fresh board, so stages move on screen.
  const agentsWorking = Object.values(cards).some((card) => card.run !== null && isActiveRun(card.run.status));
  const github = useGithubSync({
    workspaceId,
    initialSyncedAt: lastSyncedAt,
    live: agentsWorking,
    isBusy: () => dragging.current || pendingWrites.current > 0,
    onBoard: (board) => {
      setCards(board.cards);
      setColumns(board.columns);
    },
  });
  const settle = () => {
    if (!dragging.current && pendingWrites.current === 0) github.flushDeferred();
  };
  const connectHref = `/api/github/connect?next=${encodeURIComponent(`/dashboard/${workspaceId}/board`)}`;

  // ←/→ jump to the top of the neighbouring column; ↑/↓ reorder within the column (dnd-kit default).
  // The default getter alone picks "the nearest droppable" leftwards, which can be the card above.
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const { active, droppableRects } = args.context;
    if (!active) return undefined;
    const current = BOARD_COLUMNS.findIndex((c) => columnsRef.current[c.id].includes(String(active.id)));
    const target = BOARD_COLUMNS[current + (event.code === "ArrowRight" ? 1 : -1)];
    const rect = target && droppableRects.get(target.id);
    // Aim just inside the column's top-left corner: lands on its first card, or the column itself when empty.
    return rect ? { x: rect.left + 8, y: rect.top + 8 } : undefined;
  };

  const sensors = useSensors(
    // A small distance/delay lets clicks and touch scrolling work without starting a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    // Space picks up / drops; Enter is left free to open the card's details.
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    })
  );

  const findColumn = (id: UniqueIdentifier): BoardColumnId | undefined => {
    if (isBoardColumnId(id)) return id;
    return BOARD_COLUMNS.find((c) => columns[c.id].includes(String(id)))?.id;
  };

  const openCreate = (preset: { type?: BoardCard["type"]; status?: BoardColumnId } = {}) =>
    setDialog({ open: true, mode: { kind: "create", type: preset.type ?? "feature", status: preset.status ?? "todo" } });

  const openCard = (card: BoardCard) => {
    if (Date.now() - lastDropAt.current < 250) return;
    setDialog({ open: true, mode: { kind: "edit", card, status: findColumn(card.id) ?? "todo" } });
  };

  const submitCard: CardDialogSubmit = async (input) => {
    if (dialog.mode.kind === "create") {
      const result = await createCardAction(workspaceId, input);
      if (!result.ok) return result.error;
      const { card } = result;
      setCards((prev) => ({ ...prev, [card.id]: card }));
      // New cards go to the top of their column (the server gives them the lowest position).
      setColumns((prev) => ({ ...prev, [input.status]: [card.id, ...prev[input.status]] }));
      setHighlightId(card.id);
      // If the active filters would hide the new card, drop them so the user sees what they created.
      if (!matchesFilters(card, filters)) setFilters(NO_FILTERS);
      return;
    }

    const result = await updateCardAction(workspaceId, dialog.mode.card.id, input);
    if (!result.ok) return result.error;
    const { card } = result;
    // The edit response doesn't carry the agent run; keep the one the board already shows.
    setCards((prev) => ({ ...prev, [card.id]: { ...card, run: prev[card.id]?.run ?? card.run } }));
    // A status change from the form appends the card to its new column (same as the server).
    setColumns((prev) => {
      const from = BOARD_COLUMNS.find((c) => prev[c.id].includes(card.id))?.id;
      if (!from || from === input.status) return prev;
      return { ...prev, [from]: prev[from].filter((id) => id !== card.id), [input.status]: [...prev[input.status], card.id] };
    });
  };

  // Run: the server starts the agent pipeline, then returns the card assigned to the analyst.
  const runCard = async (card: BoardCard) => {
    if (runningIds.has(card.id)) return;
    setRunningIds((prev) => new Set(prev).add(card.id));
    try {
      const result = await runCardAction(workspaceId, card.id);
      if (!result.ok) return setBoardError(result.error);
      setCards((prev) => (prev[card.id] ? { ...prev, [card.id]: result.card } : prev));
      // The analyst takes it: the server put it on top of Analysis.
      setColumns((prev) => {
        const without = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, prev[c.id].filter((id) => id !== card.id)])) as BoardColumns;
        return { ...without, analysis: [card.id, ...without.analysis] };
      });
    } catch {
      setBoardError(`We couldn't start the analyst on ${card.key}. Please try again.`);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    }
  };

  const stopCard = async (card: BoardCard) => {
    pendingWrites.current++;
    try {
      const result = await stopCardAction(workspaceId, card.id);
      if (!result.ok) return setBoardError(result.error);
      setCards((prev) => (prev[card.id] ? { ...prev, [card.id]: result.card } : prev));
      // A card stopped during analysis goes back to Todo on the server; mirror it.
      setColumns((prev) => {
        const from = BOARD_COLUMNS.find((c) => prev[c.id].includes(card.id))?.id;
        if (from !== "analysis") return prev;
        return { ...prev, analysis: prev.analysis.filter((id) => id !== card.id), todo: [card.id, ...prev.todo] };
      });
    } catch {
      setBoardError(`We couldn't stop the agents on ${card.key}. Please try again.`);
    } finally {
      pendingWrites.current--;
      settle();
    }
  };

  // Merge: the server merges the card's PR (or the Tester files a follow-up when it can't), then the fresh board
  // shows the result — the card in Done, or the follow-up card in Todo.
  const mergeCard = async (card: BoardCard) => {
    if (mergingIds.has(card.id)) return;
    setMergingIds((prev) => new Set(prev).add(card.id));
    pendingWrites.current++;
    try {
      const result = await mergeCardAction(workspaceId, card.id);
      if (!result.ok) setBoardError(`${card.key}: ${result.error}`);
    } catch {
      setBoardError(`We couldn't merge ${card.key}'s pull request. Please try again.`);
    } finally {
      setMergingIds((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
      pendingWrites.current--;
      settle();
      void github.sync({ includeBoard: true });
    }
  };

  const confirmRemove = async () => {
    const card = removal.card;
    if (!card || removal.pending) return;
    setRemoval((r) => ({ ...r, pending: true }));
    pendingWrites.current++;
    try {
      const result = await removeCardAction(workspaceId, card.id);
      if (!result.ok) {
        setBoardError(result.error);
      } else {
        setColumns((prev) =>
          Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, prev[c.id].filter((id) => id !== card.id)])) as BoardColumns
        );
        setCards((prev) => {
          const { [card.id]: _removed, ...rest } = prev;
          return rest;
        });
      }
    } catch {
      setBoardError("We couldn't remove the card. Please try again.");
    } finally {
      pendingWrites.current--;
      setRemoval((r) => ({ ...r, open: false, pending: false }));
      settle();
    }
  };

  // Cross-column moves happen while dragging, so the placeholder follows the pointer between columns.
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(active.id);
    const to = findColumn(over.id);
    if (!from || !to || from === to) return;

    setColumns((prev) => {
      const target = prev[to];
      const overIndex = target.indexOf(String(over.id));
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      const index = isBoardColumnId(over.id) || overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      return {
        ...prev,
        [from]: prev[from].filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  };

  // Reordering inside a column is committed on drop, then every changed column is saved.
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const before = snapshot.current;
    snapshot.current = null;
    setActiveId(null);
    dragging.current = false;
    lastDropAt.current = Date.now();

    let next = columns;
    const column = over ? findColumn(active.id) : undefined;
    if (over && column && column === findColumn(over.id)) {
      const from = columns[column].indexOf(String(active.id));
      const to = isBoardColumnId(over.id) ? columns[column].length - 1 : columns[column].indexOf(String(over.id));
      if (from !== to && to >= 0) next = { ...columns, [column]: arrayMove(columns[column], from, to) };
    }
    if (next !== columns) setColumns(next);
    const changed = before
      ? Object.fromEntries(BOARD_COLUMNS.filter((c) => next[c.id].join() !== before[c.id].join()).map((c) => [c.id, next[c.id]]))
      : {};
    if (!before || Object.keys(changed).length === 0) return settle();

    // Optimistic: the board already shows the move. Roll back if the server refuses it.
    pendingWrites.current++;
    moveCardsAction(workspaceId, changed)
      .then(({ ok }) => {
        if (ok) return;
        setColumns(before);
        setBoardError("We couldn't save that move, so the card went back to where it was. Please try again.");
      })
      .finally(() => {
        pendingWrites.current--;
        settle();
      });
  };

  const titleOf = (id: UniqueIdentifier) => cards[String(id)]?.title ?? "card";
  const positionIn = (id: UniqueIdentifier) => {
    const column = findColumn(id);
    if (!column) return "";
    const index = isBoardColumnId(id) ? columns[column].length : columns[column].indexOf(String(id)) + 1;
    return `${COLUMN_TITLE[column]}, position ${index} of ${columns[column].length}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. In ${positionIn(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${positionIn(over.id)}.` : `${titleOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(active.id)} in ${positionIn(over.id)}.` : `Dropped ${titleOf(active.id)}.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  const total = Object.keys(cards).length;
  const activeCard = activeId ? cards[String(activeId)] : null;

  const filtering = isFiltering(deferredFilters);
  const allCards = Object.values(cards);
  const searchHits = allCards.filter((card) => matchesQuery(card, deferredFilters.query));
  const counts: Record<TypeFilter, number> = {
    all: searchHits.length,
    feature: searchHits.filter((c) => c.type === "feature").length,
    bug: searchHits.filter((c) => c.type === "bug").length,
    issue: searchHits.filter((c) => c.type === "issue").length,
  };
  // Filtering only hides cards; `columns` keeps the full order, so drag and drop stays consistent.
  const visibleIn = (column: BoardColumnId) =>
    columns[column].map((id) => cards[id]!).filter((card) => card && (!filtering || matchesFilters(card, deferredFilters)));
  const visibleTotal = filtering ? allCards.filter((card) => matchesFilters(card, deferredFilters)).length : total;

  return (
    // data-page-width lets the dashboard layout drop its max width for this page.
    <div data-page-width="full" className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        eyebrow="Plan"
        title="Board"
        description={
          total === 0
            ? `No cards yet. Open issues from ${repo} appear here automatically, or create a feature, bug or issue.`
            : `${total} ${total === 1 ? "card" : "cards"} across ${BOARD_COLUMNS.length} stages, kept in sync with ${repo}'s issues. Click a card for details, or drag it to move it.`
        }
        actions={
          <>
            <GithubSyncButton state={github.state} onSync={() => void github.sync({ manual: true })} repo={repo} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button className="h-10 px-4" />}>
                <PlusIcon />
                New
                <ChevronDownIcon data-icon="inline-end" className="opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="eyebrow text-muted-foreground">Create</DropdownMenuLabel>
                  {ISSUE_TYPES.map((type) => {
                    const meta = ISSUE_TYPE_META[type];
                    return (
                      <DropdownMenuItem key={type} onClick={() => openCreate({ type })} className="gap-2.5 py-2">
                        <meta.icon className={cn("size-4", meta.tone)} />
                        <span className="flex flex-col">
                          <span className="font-medium">{meta.label}</span>
                          <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <BoardToolbar filters={filters} onChange={setFilters} counts={counts} visible={visibleTotal} total={total} />

      <GithubSyncNotice state={github.state} repo={repo} connectHref={connectHref} onRetry={() => void github.sync({ manual: true })} />

      {boardError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
        >
          <CircleAlertIcon className="size-4 shrink-0" />
          <p className="flex-1">{boardError}</p>
          <Button variant="ghost" size="sm" onClick={() => setBoardError(null)} className="text-destructive">
            Dismiss
          </Button>
        </div>
      )}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press enter to open the card. To move it, press space to pick it up, use the up and down arrow keys within a column and the left and right arrow keys to change column, then press space to drop it or escape to cancel.",
          },
        }}
        onDragStart={({ active }: DragStartEvent) => {
          dragging.current = true;
          snapshot.current = columns;
          setActiveId(active.id);
          setOverlayWidth(active.rect.current.initial?.width);
          setHighlightId(null);
        }}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          if (snapshot.current) setColumns(snapshot.current);
          snapshot.current = null;
          setActiveId(null);
          dragging.current = false;
          settle();
        }}
      >
        {/*
          Bleeds to the panel edges so the horizontal scroll reaches them. `relative` makes this the containing
          block for absolutely positioned descendants (sr-only labels), otherwise they escape the overflow clip
          and widen the whole page on mobile.
        */}
        <div className="relative -mx-6 flex flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto px-6 pb-4 lg:-mx-10 lg:px-10 xl:snap-none">
          {BOARD_COLUMNS.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              cards={visibleIn(column.id)}
              totalCount={columns[column.id].length}
              filtering={filtering}
              highlightId={highlightId}
              runningIds={runningIds}
              mergingIds={mergingIds}
              onAdd={() => openCreate({ status: column.id })}
              onOpenCard={openCard}
              onRunCard={(card) => void runCard(card)}
              onStopCard={(card) => void stopCard(card)}
              onMergeCard={(card) => void mergeCard(card)}
              onRemoveCard={(card) => setRemoval({ open: true, card, pending: false })}
            />
          ))}
        </div>

        {/* The lifted copy that follows the pointer. A floating layer, so it may carry a shadow. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeCard ? (
            <BoardCardView
              card={activeCard}
              style={{ width: overlayWidth }}
              className="rotate-2 cursor-grabbing border-brand/40 shadow-lg"
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CardDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        mode={dialog.mode}
        onSubmit={submitCard}
      />

      <AlertDialog open={removal.open} onOpenChange={(open) => !removal.pending && setRemoval((r) => ({ ...r, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removal.card?.key} from the board?</AlertDialogTitle>
            <AlertDialogDescription>
              {removal.card?.github
                ? `“${removal.card.title}” leaves the board for good. Issue #${removal.card.github.number} stays open on GitHub and won't be synced back.`
                : `“${removal.card?.title ?? ""}” leaves the board for good. Its key won't be reused.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removal.pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRemove()} disabled={removal.pending}>
              {removal.pending && <Spinner />}
              {removal.pending ? "Removing…" : "Remove task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
