"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import type { GithubSyncState } from "@/components/board/use-github-sync";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Re-renders every 30 s so "Synced 2m ago" stays truthful. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function syncedLabel(lastSyncedAt: string | null, now: number) {
  if (!lastSyncedAt) return "Not synced yet";
  const at = new Date(lastSyncedAt);
  return now - at.getTime() < 45_000 ? "Synced just now" : `Synced ${formatDistanceToNowStrict(at, { addSuffix: true })}`;
}

/** Status text + Refresh button for the board header. */
export function GithubSyncButton({ state, onSync, repo }: { state: GithubSyncState; onSync: () => void; repo: string }) {
  const now = useNow();
  const syncing = state.status === "syncing";

  return (
    <div className="flex items-center gap-3">
      <p className="hidden text-right text-xs text-muted-foreground md:block" aria-live="polite">
        {syncing ? "Syncing with GitHub…" : syncedLabel(state.lastSyncedAt, now)}
        {!syncing && state.summary && (
          <>
            <br />
            <span className="font-semibold text-foreground">{state.summary}</span>
          </>
        )}
      </p>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" className="h-10 px-4" onClick={onSync} disabled={syncing} aria-label={`Fetch new issues from ${repo}`} />
          }
        >
          <RefreshCwIcon className={cn(syncing && "animate-spin")} />
          Refresh
        </TooltipTrigger>
        <TooltipContent>Fetch new issues from {repo}</TooltipContent>
      </Tooltip>
    </div>
  );
}

const FAILURE_COPY = {
  not_connected: (repo: string) => `Reconnect GitHub to bring ${repo}'s issues onto the board.`,
  reconnect: () => "Your GitHub connection expired or was revoked. Reconnect to keep issues in sync.",
  no_access: (repo: string) => `We can't read issues from ${repo}. Check that your GitHub account still has access to it.`,
  error: () => "We couldn't reach GitHub just now. We'll keep trying in the background.",
  unavailable: () => "We couldn't sync the board just now. We'll keep trying in the background.",
} as const;

/** Explains a failed sync and offers the fix when there is one. */
export function GithubSyncNotice({
  state,
  repo,
  connectHref,
  onRetry,
}: {
  state: GithubSyncState;
  repo: string;
  connectHref: string;
  onRetry: () => void;
}) {
  if (state.status !== "error" || !state.failure) return null;
  const needsConnect = state.failure === "not_connected" || state.failure === "reconnect";

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg px-4 py-2.5 text-sm ring-1",
        needsConnect ? "bg-muted/60 ring-border" : "bg-destructive/5 text-destructive ring-destructive/30"
      )}
    >
      {needsConnect ? <GitHubIcon className="size-4 shrink-0" /> : <CircleAlertIcon className="size-4 shrink-0" />}
      <p className="min-w-0 flex-1">{FAILURE_COPY[state.failure](repo)}</p>
      {needsConnect ? (
        <a href={connectHref} className={buttonVariants({ size: "sm", className: "h-8 px-3" })}>
          <GitHubIcon className="size-3.5" />
          Reconnect GitHub
        </a>
      ) : (
        <Button variant="ghost" size="sm" onClick={onRetry} className={cn(state.failure !== "no_access" && "text-destructive")}>
          Try again
        </Button>
      )}
    </div>
  );
}
