import { AgentFace } from "@/components/ai-team/agent-face";
import type { Agent, AgentTone } from "@/lib/agents";
import { cn } from "@/lib/utils";

/** Text-color class per agent tone; tints `icon-tile`, agent accents and the fallback initial of a face. */
export const AGENT_TONE_CLASS: Record<AgentTone, string> = {
  brand: "text-brand-emphasis",
  action: "text-action",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  neutral: "text-foreground",
};

/** Small round face of an AI agent (board assignee, activity rows). Labeled with the name unless `alt` says otherwise. */
export function AgentAvatar({
  agent,
  alt = agent.name,
  className,
}: {
  agent: Pick<Agent, "id" | "name" | "tone">;
  alt?: string;
  className?: string;
}) {
  return (
    <span title={agent.name} className="inline-flex shrink-0">
      <AgentFace agent={agent} alt={alt} toneClass={AGENT_TONE_CLASS[agent.tone]} className={cn("size-7 text-xs", className)} />
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
