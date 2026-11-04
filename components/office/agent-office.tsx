"use client";

import Image from "next/image";

import { SurfaceHeader } from "@/components/dashboard/page-header";
import { useLiveTeam } from "@/components/office/live-team";
import { OfficeAgent } from "@/components/office/office-agent";
import { OFFICE } from "@/components/office/office-scene";
import { cn } from "@/lib/utils";

/** "Live" while polling works; says so when the last refresh failed. */
function LiveChip({ connected, working }: { connected: boolean; working: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium ring-1 ring-border">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", connected ? "animate-pulse bg-success" : "bg-muted-foreground")}
      />
      {connected ? "Live" : "Reconnecting…"}
      {connected && working > 0 && <span className="text-muted-foreground">· {working} working</span>}
    </span>
  );
}

/**
 * The live office: the team at their desks, typing while they work. Reads status from <LiveTeamProvider>, so it
 * updates on its own. Used on the AI Team page.
 */
export function AgentOffice({
  workspaceId,
  title = "AI Agent Office Space",
  description = "See your agents at work, live",
  className,
}: {
  workspaceId: number;
  title?: string;
  description?: string;
  className?: string;
}) {
  const { team, connected } = useLiveTeam();
  const working = team.members.filter((m) => m.status === "working").length;
  const boardHref = `/dashboard/${workspaceId}/board`;
  const teamHref = `/dashboard/${workspaceId}/ai-team`;

  return (
    <section className={cn("surface flex min-w-0 flex-col", className)}>
      <SurfaceHeader title={title} description={description} actions={<LiveChip connected={connected} working={working} />} />
      <div className="p-4 sm:p-6">
        <figure
          aria-label={`Office: ${working ? `${working} of ${team.members.length} agents working` : "everyone is waiting for work"}`}
          // A size container: bubbles show the full line only when the office is wide enough.
          className="@container relative isolate w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border/70"
          style={{ aspectRatio: `${OFFICE.width} / ${OFFICE.height}` }}
        >
          <Image
            src={OFFICE.background}
            alt=""
            fill
            sizes="(min-width: 1280px) 1100px, 100vw"
            className="pointer-events-none object-cover select-none"
            draggable={false}
          />
          {team.members.map((member) => (
            <OfficeAgent key={member.id} member={member} boardHref={boardHref} teamHref={teamHref} />
          ))}
        </figure>
      </div>
    </section>
  );
}
