"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityIcon, CheckIcon, CircleAlertIcon, PauseCircleIcon, ScrollTextIcon } from "lucide-react";

import { AgentPortrait } from "@/components/ai-team/agent-visuals";
import { useLiveTeam } from "@/components/ai-team/live-team";
import { IssueTypePill } from "@/components/board/issue-meta";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { AGENT_ROLES } from "@/lib/agent-config";
import { liveProcessSteps, liveRunMeta, type LiveRun, type LiveStepView, type StepState } from "@/lib/live-process";
import { cn } from "@/lib/utils";

const CHIP: Record<StepState, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-muted text-muted-foreground ring-border/70" },
  pending: { label: "Up next", className: "bg-muted text-muted-foreground ring-border/70" },
  working: { label: "Working", className: "bg-brand/8 text-brand-emphasis ring-brand/25" },
  done: { label: "Done", className: "bg-success/10 text-foreground ring-success/30" },
};

/** Ticks every second while something runs, for elapsed times. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function ago(at: Date, now: Date) {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function StepMarker({ step }: { step: LiveStepView }) {
  if (step.state === "done") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (step.state === "working") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
        <span aria-hidden className="size-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-bold text-muted-foreground tabular-nums">
      {step.number}
    </span>
  );
}

function Step({ step, last, now }: { step: LiveStepView; last: boolean; now: Date }) {
  const quiet = step.state === "idle" || step.state === "pending";
  const chip = CHIP[step.state];
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4">
      <span className="flex flex-col items-center">
        <StepMarker step={step} />
        {!last && <span aria-hidden className={cn("my-1 min-h-4 w-0.5 flex-1 rounded-full", step.state === "done" ? "bg-success" : "bg-border")} />}
      </span>
      <div className={cn("flex min-w-0 flex-col gap-1 pt-1", !last && "pb-5")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-sm font-bold">
            {step.title}
            <span className="sr-only">: {chip.label}</span>
          </h3>
          {step.people.length > 0 && (
            <span className="flex items-center">
              {step.people.map(({ agent, working }, i) => (
                <AgentPortrait
                  key={agent}
                  agent={AGENT_ROLES[agent]}
                  size="xs"
                  working={working}
                  className={cn(i > 0 && "-ml-1.5", quiet && "opacity-60 grayscale")}
                />
              ))}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{step.who}</span>
          <span aria-hidden className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold ring-1", chip.className)}>
            {chip.label}
          </span>
        </div>
        <p className={cn("text-sm", step.state === "working" ? "font-medium text-foreground" : "text-muted-foreground")}>{step.text}</p>
        {step.state === "working" && (step.actions.length > 0 || step.meta) && (
          <div className="mt-1.5 flex flex-col gap-2 rounded-lg bg-muted/50 px-3.5 py-3 ring-1 ring-border/60">
            {step.actions.length > 0 && (
              <>
                <p className="eyebrow text-muted-foreground">Latest actions</p>
                <ul className="flex flex-col gap-1.5">
                  {step.actions.map((action, i) => (
                    <li key={i} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                      {action.ok ? (
                        <CheckIcon aria-hidden className="size-3.5 text-success" strokeWidth={2.5} />
                      ) : (
                        <CircleAlertIcon aria-hidden className="size-3.5 text-error" />
                      )}
                      <span className="min-w-0 truncate">
                        {action.agent && <span className="text-muted-foreground">{AGENT_ROLES[action.agent].name} · </span>}
                        <span className="font-semibold">{action.label}</span>
                        {action.target && <span className="ml-1.5 font-mono text-muted-foreground">{action.target}</span>}
                        {!action.ok && <span className="sr-only"> (failed)</span>}
                      </span>
                      <span suppressHydrationWarning className="text-muted-foreground tabular-nums">
                        {ago(action.at, now)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {step.meta && <p className="text-xs text-muted-foreground tabular-nums">{step.meta}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

function Steps({ steps, now }: { steps: LiveStepView[]; now: Date }) {
  return (
    <ol aria-label="Pipeline steps" className="flex flex-col">
      {steps.map((step, i) => (
        <Step key={step.phase} step={step} last={i === steps.length - 1} now={now} />
      ))}
    </ol>
  );
}

function RunBlock({ run, workspaceId, now }: { run: LiveRun; workspaceId: number; now: Date }) {
  const { team } = useLiveTeam();
  return (
    <section aria-label={`${run.key}: ${run.title}`} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/50 px-4 py-3 ring-1 ring-border/60">
        <IssueTypePill type={run.type} />
        <span className="text-xs font-bold text-muted-foreground tabular-nums">{run.key}</span>
        <span className="min-w-0 flex-[1_1_12rem] truncate text-sm font-semibold">{run.title}</span>
        <span suppressHydrationWarning className="text-xs text-muted-foreground tabular-nums">
          {liveRunMeta(run, now)}
        </span>
        <Link
          href={`/dashboard/${workspaceId}/board?log=${run.taskId}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-emphasis hover:underline"
        >
          <ScrollTextIcon aria-hidden className="size-3.5" />
          Agent log
        </Link>
      </div>
      <Steps steps={liveProcessSteps(run, team.mergeMode)} now={now} />
    </section>
  );
}

function LiveChip({ working, connected, idle }: { working: number; connected: boolean; idle: boolean }) {
  const label = !connected ? "Reconnecting…" : idle ? "Inactive" : working ? `Live · ${working} working` : "Live";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-xs font-semibold",
        idle && connected ? "text-muted-foreground" : "text-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          !connected ? "bg-warning" : idle ? "bg-muted-foreground/60" : "bg-brand-emphasis motion-safe:animate-pulse"
        )}
      />
      {label}
    </span>
  );
}

/**
 * AI Team: what the agents are doing, step by step. One block per card in flight; with nothing running, the six
 * steps idle with what each one does. Live through <LiveTeamProvider> (no writes).
 */
export function LiveProcess({ workspaceId }: { workspaceId: number }) {
  const { team, connected } = useLiveTeam();
  const runs = team.runs;
  const now = useNow(runs.length > 0);
  const working = team.members.filter((m) => m.status === "working").length;

  return (
    <section className="surface min-w-0" aria-label="Live process">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <ActivityIcon />
          </span>
        }
        title="Live process"
        description="What the agents are doing, step by step."
        actions={<LiveChip working={working} connected={connected} idle={runs.length === 0} />}
      />
      <div className="flex flex-col gap-8 p-6">
        {runs.length === 0 ? (
          <>
            <p className="flex items-start gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm ring-1 ring-border/60">
              <PauseCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-semibold">Inactive.</span>{" "}
                <span className="text-muted-foreground">
                  No card in progress. Run a card from the{" "}
                  <Link href={`/dashboard/${workspaceId}/board`} className="font-medium text-brand-emphasis hover:underline">
                    board
                  </Link>
                  , or turn on auto pickup in{" "}
                  <Link href={`/dashboard/${workspaceId}/settings#agents`} className="font-medium text-brand-emphasis hover:underline">
                    Settings
                  </Link>
                  .
                </span>
              </span>
            </p>
            <Steps steps={liveProcessSteps(null, team.mergeMode)} now={now} />
          </>
        ) : (
          runs.map((run) => <RunBlock key={run.runId} run={run} workspaceId={workspaceId} now={now} />)
        )}
      </div>
    </section>
  );
}
