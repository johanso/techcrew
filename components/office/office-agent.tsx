"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRightIcon, CpuIcon, HistoryIcon } from "lucide-react";

import { AGENT_STATUS, AgentPortrait, AgentStatusBadge, BudgetMeter } from "@/components/ai-team/agent-visuals";
import { OFFICE, pctX, pctY, seatFor, TYPING_FPS } from "@/components/office/office-scene";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TeamMember } from "@/lib/agents";
import { cn } from "@/lib/utils";

const ago = (date: Date) => formatDistanceToNowStrict(date, { addSuffix: true });

/** "Reviewing ACM-142" while working, else the status ("Ready", "Paused", "Over budget"). */
function bubbleLabel(member: TeamMember) {
  return member.currentTask ?? AGENT_STATUS[member.status].label;
}

function TypingDots() {
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="office-dot size-1 rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/** The status bubble floating above the agent's head. Decorative: the agent's button carries the same text. */
function StatusBubble({ member }: { member: TeamMember }) {
  const seat = seatFor(member.id);
  const working = member.status === "working";
  const label = bubbleLabel(member);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full pb-1.5 @md:pb-2"
      style={{ left: pctX(seat.x + seat.head.x * seat.width), top: pctY(seat.y + seat.head.y * seat.height) }}
    >
      <div
        // Re-keyed on change so a new status fades in instead of swapping silently.
        key={label}
        className={cn(
          // Smaller in a narrow office (phones), so bubbles stay in proportion with the characters.
          "relative flex animate-in items-center gap-1 rounded-full bg-popover px-1.5 py-0.5 text-[9px] leading-none font-semibold whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10 fade-in duration-300 @md:gap-1.5 @md:px-2 @md:py-1 @md:text-[11px]",
          member.status === "over_budget" && "text-error"
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", AGENT_STATUS[member.status].dot)} />
        {/* Narrow offices show just the card key (or the status); wide ones the whole line. */}
        <span className="hidden @xl:inline">{label}</span>
        <span className="@xl:hidden">{member.task?.key ?? AGENT_STATUS[member.status].label}</span>
        {working && <TypingDots />}
        <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-popover" />
      </div>
    </div>
  );
}

/** What the hover card says about the agent: current card, last work, model and this month's spend. */
function AgentDetails({ member, boardHref, teamHref }: { member: TeamMember; boardHref: string; teamHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <AgentPortrait agent={member} status={member.status} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-bold">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">{member.role}</p>
        </div>
        <AgentStatusBadge status={member.status} />
      </div>

      {member.task ? (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 ring-1 ring-border/70">
          <p className="eyebrow text-muted-foreground">Working on</p>
          <p className="line-clamp-2 text-sm font-semibold">
            <span className="tabular-nums">{member.task.key}</span> · {member.task.title}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="office-dot size-1.5 rounded-full bg-action" aria-hidden />
            Run started {ago(member.task.startedAt)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 ring-1 ring-border/70">
          <p className="eyebrow text-muted-foreground">Last work</p>
          {member.lastAction ? (
            <p className="flex min-w-0 items-center gap-1.5 text-sm">
              <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{member.lastAction.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(member.lastAction.at)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No work yet. {AGENT_STATUS[member.status].hint}.</p>
          )}
        </div>
      )}

      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CpuIcon className="size-3.5 shrink-0" />
        <span className="truncate">{member.model}</span>
      </p>
      <BudgetMeter spentMicros={member.monthSpendMicros} budgetCents={member.monthlyBudgetCents} label="this month" />

      <Link
        href={member.task ? boardHref : teamHref}
        className="flex items-center justify-end gap-1 text-xs font-medium text-brand-emphasis hover:underline"
      >
        {member.task ? "Open the board" : `Configure ${member.name}`}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  );
}

/**
 * One agent at its desk: the character (typing while it works), its status bubble, and a hover/tap card with more.
 * Placed in percentages of the office picture, so it stays on its chair at any size.
 */
export function OfficeAgent({ member, boardHref, teamHref }: { member: TeamMember; boardHref: string; teamHref: string }) {
  const seat = seatFor(member.id);
  const working = member.status === "working";
  const away = member.status === "paused" || member.status === "over_budget";
  // The card opens on the side with more room.
  const side = seat.x + seat.width / 2 > OFFICE.width * 0.55 ? "left" : "right";

  return (
    <>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={120}
          closeDelay={150}
          aria-label={`${member.name}: ${bubbleLabel(member)}`}
          className="group absolute cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: pctX(seat.x),
            top: pctY(seat.y),
            width: pctX(seat.width),
            height: pctY(seat.height),
            zIndex: seat.zIndex,
          }}
        >
          <span
            className={cn(
              "office-sprite block size-full transition-[filter] duration-200 group-hover:brightness-110 group-focus-visible:brightness-110 group-data-[popup-open]:brightness-110",
              working && "office-typing",
              away && "opacity-75 grayscale-[.6]"
            )}
            style={
              {
                backgroundImage: `url(${seat.sprite})`,
                "--office-frames": seat.frames,
                "--office-duration": `${seat.frames / TYPING_FPS}s`,
              } as React.CSSProperties
            }
          />
        </PopoverTrigger>
        <PopoverContent side={side} align="center" sideOffset={8} className="w-72 p-4">
          <AgentDetails member={member} boardHref={boardHref} teamHref={teamHref} />
        </PopoverContent>
      </Popover>
      <StatusBubble member={member} />
    </>
  );
}
