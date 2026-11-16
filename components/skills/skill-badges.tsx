import { CircleAlertIcon, CircleCheckIcon, ShieldCheckIcon } from "lucide-react";

import { AgentPortrait } from "@/components/ai-team/agent-visuals";
import { AGENT_ROLES, type AgentKey } from "@/lib/agent-config";
import { SKILL_LOAD_META, SKILL_SOURCE_META, SKILL_TYPE_META, type SkillView } from "@/lib/agent-skills-config";
import { cn } from "@/lib/utils";

/** Small pill shared by the skill badges. */
function Pill({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold whitespace-nowrap text-muted-foreground ring-1 ring-border/70", className)}
    >
      {children}
    </span>
  );
}

/** Type · load · source of a skill (Settings library, configure dialog). */
export function SkillBadges({ skill, className }: { skill: Pick<SkillView, "type" | "load" | "source">; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      <Pill title={SKILL_TYPE_META[skill.type].hint}>{SKILL_TYPE_META[skill.type].label}</Pill>
      <Pill title={SKILL_LOAD_META[skill.load].hint}>{SKILL_LOAD_META[skill.load].label}</Pill>
      <Pill className={skill.source === "builtin" ? "bg-brand/8 text-brand-emphasis ring-brand/20" : undefined}>{SKILL_SOURCE_META[skill.source].label}</Pill>
    </span>
  );
}

/** The skill's security scan in a few words: reviewed (built-in), passed, or how many findings. */
export function SkillScanChip({ scan }: { scan: SkillView["scan"] }) {
  if (!scan) return null;
  if (scan.reviewedBy === "builtin") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Vendored in TechTeam's repository and reviewed in a pull request">
        <ShieldCheckIcon aria-hidden className="size-3.5 text-success" />
        Reviewed
      </span>
    );
  }
  if (scan.status === "passed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-3.5 text-success" />
        Scan passed{scan.reviewedBy === "ai" ? " · AI reviewed" : ""}
      </span>
    );
  }
  const count = scan.findings.length;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
      <CircleAlertIcon aria-hidden className="size-3.5 text-warning" />
      {count} scan finding{count === 1 ? "" : "s"}
    </span>
  );
}

/** Identity for AgentPortrait from a role key (client-safe). */
export const agentOf = (key: AgentKey) => ({ id: key, name: AGENT_ROLES[key].name, tone: AGENT_ROLES[key].tone });

/** Overlapping faces of the agents that have a skill switched on. */
export function SkillAgents({ keys, empty = "No agents" }: { keys: AgentKey[]; empty?: string }) {
  if (!keys.length) return <span className="text-xs text-muted-foreground">{empty}</span>;
  const names = keys.map((key) => AGENT_ROLES[key].name).join(", ");
  return (
    <span className="flex items-center gap-2" title={names}>
      <span className="flex -space-x-1.5" role="img" aria-label={`Switched on for ${names}`}>
        {keys.map((key) => (
          <AgentPortrait key={key} agent={agentOf(key)} size="xs" className="rounded-full ring-2 ring-card" />
        ))}
      </span>
      <span className="truncate text-xs text-muted-foreground">{names}</span>
    </span>
  );
}
