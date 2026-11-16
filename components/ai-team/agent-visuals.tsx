import { AgentFace } from "@/components/ai-team/agent-face";
import { AGENT_TONE_CLASS } from "@/components/dashboard/agent-avatar";
import { MICROS_PER_USD, formatCents, formatMicros, type AgentKey, type AgentTone } from "@/lib/agent-config";
import { trustGrade } from "@/lib/agent-trust";
import type { AgentStatus } from "@/lib/agents";
import { cn } from "@/lib/utils";

export const AGENT_STATUS: Record<AgentStatus, { label: string; dot: string; hint: string }> = {
  ready: { label: "Ready", dot: "bg-success", hint: "Waiting for work" },
  working: { label: "Working", dot: "bg-brand-emphasis animate-pulse", hint: "Has open cards" },
  paused: { label: "Paused", dot: "bg-muted-foreground", hint: "Won't pick up new work" },
  over_budget: { label: "Over budget", dot: "bg-error", hint: "Monthly budget used" },
};

const PORTRAIT_SIZE = {
  sm: "size-8 text-sm",
  md: "size-11 text-base",
  lg: "size-16 text-xl",
};

/**
 * Agent avatar: the agent's face with an optional status dot on its corner. `working` adds a brand ring that pulses
 * (still under reduced motion). `alt` stays empty when the agent's name is shown next to it.
 */
export function AgentPortrait({
  agent,
  status,
  working = false,
  size = "md",
  alt = "",
  className,
}: {
  agent: { id: AgentKey; name: string; tone: AgentTone };
  status?: AgentStatus;
  working?: boolean;
  size?: keyof typeof PORTRAIT_SIZE;
  alt?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <AgentFace agent={agent} alt={alt} toneClass={AGENT_TONE_CLASS[agent.tone]} className={PORTRAIT_SIZE[size]} />
      {working && (
        <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full ring-2 ring-brand-emphasis motion-safe:animate-pulse" />
      )}
      {status && (
        <span
          aria-hidden
          className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card", AGENT_STATUS[status].dot)}
        />
      )}
    </span>
  );
}

/** Status pill. The dot carries the color; the label stays high-contrast text. */
export function AgentStatusBadge({ status, className }: { status: AgentStatus; className?: string }) {
  const meta = AGENT_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-xs font-medium ring-1 ring-border/70",
        status === "over_budget" && "bg-error/10 text-error ring-error/20",
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Spend against budget: neutral until 75 %, warning until 100 %, error beyond. */
export function BudgetMeter({
  spentMicros,
  budgetCents,
  label,
  className,
}: {
  spentMicros: number;
  budgetCents: number;
  label?: string;
  className?: string;
}) {
  const budgetMicros = budgetCents * (MICROS_PER_USD / 100);
  const ratio = budgetMicros > 0 ? spentMicros / budgetMicros : 0;
  const percent = Math.min(100, ratio * 100);
  // Any spend shows at least a sliver, so "used a little" never looks like "used nothing".
  const width = spentMicros > 0 ? Math.max(percent, 1.5) : 0;
  const fill = ratio >= 1 ? "bg-error" : ratio >= 0.75 ? "bg-warning" : "bg-brand-emphasis";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{formatMicros(spentMicros)}</span> of{" "}
          <span className="tabular-nums">{formatCents(budgetCents)}</span>
          {label && ` ${label}`}
        </span>
        <span className={cn("shrink-0 font-semibold tabular-nums", ratio >= 1 ? "text-error" : "text-muted-foreground")}>
          {percent < 1 && spentMicros > 0 ? "<1" : Math.round(percent)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** Circular 0–100 gauge colored by trust grade. */
export function TrustRing({ score, size = 88, className }: { score: number; size?: number; className?: string }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const grade = trustGrade(score);

  return (
    <div className={cn("relative shrink-0", grade.tone, className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-foreground">
        <span className="text-2xl leading-none font-bold tabular-nums">{score}</span>
        <span className="text-[10px] font-medium text-muted-foreground">/ 100</span>
      </span>
    </div>
  );
}

/** Compact trust score for cards: shield + score, colored by grade. */
export function TrustChip({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scanned</span>;
  const grade = trustGrade(score);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" title={`Skill Trust Score: ${grade.label}`}>
      <span aria-hidden className={cn("size-1.5 rounded-full bg-current", grade.tone)} />
      <span className="font-semibold tabular-nums">{score}</span>
      <span className="text-muted-foreground">trust</span>
    </span>
  );
}
