"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getBoardAction, syncIssuesAction } from "@/app/dashboard/[workspaceId]/board/actions";
import type { BoardData } from "@/lib/board-config";
import type { SyncCounts, SyncResult } from "@/lib/github-issues";

/** Why the last sync failed: GitHub's answer (SyncResult), or "unavailable" when our server didn't answer. */
export type SyncFailure = Extract<SyncResult, { ok: false }>["reason"] | "unavailable";

export type GithubSyncState = {
  status: "idle" | "syncing" | "error";
  lastSyncedAt: string | null;
  failure?: SyncFailure;
  /** What the latest sync changed, e.g. "3 new · 1 closed". */
  summary?: string;
};

// Polling stands in for webhooks (which would need a public URL and admin rights on the repo).
const POLL_MS = 60_000;
// While agents work on a card, the board follows their progress (stage moves, PRs) at this pace. These polls only
// read the database; GitHub is still synced every POLL_MS.
const LIVE_POLL_MS = 10_000;
const REFOCUS_MIN_GAP_MS = 15_000;

function summarize({ added, updated, closed, reopened }: SyncCounts) {
  return [
    added && `${added} new`,
    closed && `${closed} closed`,
    reopened && `${reopened} reopened`,
    updated && `${updated} updated`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Keeps the board in sync with the repository's GitHub issues: on mount, when the tab regains focus,
 * every minute while visible, and on demand. While `live`, the board is also re-read every 10 s (database only). `isBusy` reports a drag or an unsaved move — a fresh board
 * must not land then (it would undo the move on screen), so it's fetched again via `flushDeferred` later.
 */
export function useGithubSync({
  workspaceId,
  initialSyncedAt,
  live,
  isBusy,
  onBoard,
}: {
  workspaceId: number;
  initialSyncedAt: string | null;
  /** Agents are working on a card: poll often and always fetch the board. */
  live: boolean;
  isBusy: () => boolean;
  onBoard: (board: BoardData) => void;
}) {
  // Every visit (navigation or reload) starts with a sync, so say so from the first paint.
  const [state, setState] = useState<GithubSyncState>({ status: "syncing", lastSyncedAt: initialSyncedAt });
  const inFlight = useRef(false);
  const lastStartedAt = useRef(0);
  // A changed board arrived while busy; ask for it again once the board is idle.
  const deferred = useRef(false);
  // Auto-sync pauses when it can't succeed without the user (no GitHub connection / no repo access).
  const paused = useRef(false);
  const callbacks = useRef({ isBusy, onBoard });
  useEffect(() => {
    callbacks.current = { isBusy, onBoard };
  });

  const sync = useCallback(
    async ({ manual = false, includeBoard = false }: { manual?: boolean; includeBoard?: boolean } = {}) => {
      if (inFlight.current || (!manual && paused.current)) return;
      inFlight.current = true;
      lastStartedAt.current = Date.now();
      setState((s) => ({ ...s, status: "syncing" }));
      try {
        const result = await syncIssuesAction(workspaceId, { includeBoard: includeBoard || deferred.current });
        if (!result.ok) {
          paused.current = result.reason !== "error";
          setState((s) => ({ ...s, status: "error", failure: result.reason }));
          return;
        }
        paused.current = false;
        if (result.board) {
          if (callbacks.current.isBusy()) {
            deferred.current = true;
          } else {
            deferred.current = false;
            callbacks.current.onBoard(result.board);
          }
        }
        setState({
          status: "idle",
          lastSyncedAt: result.syncedAt,
          summary: summarize(result) || (manual ? "Up to date" : undefined),
        });
      } catch {
        // The action itself failed (our server, the auth service …): GitHub wasn't necessarily involved.
        setState((s) => ({ ...s, status: "error", failure: "unavailable" }));
      } finally {
        inFlight.current = false;
      }
    },
    [workspaceId]
  );

  // Agents' progress is in the database: no GitHub call needed. Failures just wait for the next tick.
  const refreshBoard = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const board = await getBoardAction(workspaceId);
      if (!board) return;
      if (callbacks.current.isBusy()) {
        deferred.current = true;
      } else {
        deferred.current = false;
        callbacks.current.onBoard(board);
      }
    } catch {
      // The next tick (or the minute sync) tries again.
    } finally {
      inFlight.current = false;
    }
  }, [workspaceId]);

  /** Call when a drag or move finishes: applies a board that had to be skipped meanwhile. */
  const flushDeferred = useCallback(() => {
    if (deferred.current) void sync();
  }, [sync]);

  useEffect(() => {
    void sync();
    const onReturn = () => {
      if (document.visibilityState === "visible" && Date.now() - lastStartedAt.current > REFOCUS_MIN_GAP_MS) void sync();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [sync]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBoard();
    }, LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, refreshBoard]);

  return { state, sync, flushDeferred };
}
