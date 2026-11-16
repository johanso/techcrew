"use client";

import { createContext, use, useEffect, useState } from "react";

import { getTeamStatusAction } from "@/app/dashboard/[workspaceId]/actions";
import type { TeamOverview } from "@/lib/agents";

// Faster while someone is working, so stage changes show within seconds; slower when the team is idle.
const POLL_WORKING_MS = 5_000;
const POLL_IDLE_MS = 15_000;

type LiveTeam = { team: TeamOverview; connected: boolean };

const LiveTeamContext = createContext<LiveTeam | null>(null);

/**
 * Keeps the team's status fresh for everything below it (AI Team cards and live process, Overview's AI team card) with one poll. Polls only while the
 * tab is visible, and right away when it becomes visible again.
 */
export function LiveTeamProvider({
  workspaceId,
  initial,
  children,
}: {
  workspaceId: number;
  initial: TeamOverview;
  children: React.ReactNode;
}) {
  const [live, setLive] = useState<LiveTeam>({ team: initial, connected: true });
  const working = live.team.members.some((m) => m.status === "working");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      try {
        const team = await getTeamStatusAction(workspaceId);
        if (!cancelled && team) setLive({ team, connected: true });
      } catch {
        if (!cancelled) setLive((prev) => ({ ...prev, connected: false }));
      }
      if (!cancelled) timer = setTimeout(poll, working ? POLL_WORKING_MS : POLL_IDLE_MS);
    };

    timer = setTimeout(poll, working ? POLL_WORKING_MS : POLL_IDLE_MS);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, working]);

  return <LiveTeamContext value={live}>{children}</LiveTeamContext>;
}

export function useLiveTeam() {
  const live = use(LiveTeamContext);
  if (!live) throw new Error("useLiveTeam must be used inside <LiveTeamProvider>.");
  return live;
}
