import type { Agent, AgentTone } from "@/lib/agents";
import { cn } from "@/lib/utils";

/** Text-color class per agent tone; tints `icon-tile` and agent accents. */
export const AGENT_TONE_CLASS: Record<AgentTone, string> = {
  brand: "text-brand-emphasis",
  action: "text-action",
  success: "text-success",
  warning: "text-warning",
};

/** Round, tinted initial for an AI agent. */
export function AgentAvatar({ agent, className }: { agent: Pick<Agent, "name" | "tone">; className?: string }) {
  return (
    <span
      title={agent.name}
      className={cn("icon-tile size-7 rounded-full text-xs font-bold", AGENT_TONE_CLASS[agent.tone], className)}
    >
      {agent.name[0]}
    </span>
  );
}

/** Neutral initial for a human user, same footprint as AgentAvatar. */
export function UserInitial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground ring-1 ring-border",
        className
      )}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}
