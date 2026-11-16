"use client";

import { CheckIcon } from "lucide-react";

import { AgentPortrait } from "@/components/ai-team/agent-visuals";
import { agentOf } from "@/components/skills/skill-badges";
import { AGENT_KEYS, AGENT_ROLES, type AgentKey } from "@/lib/agent-config";
import { cn } from "@/lib/utils";

/** "Assign to:" the six agents as checkbox cards with their faces; `suggested` ones are tagged. Native checkboxes underneath. */
export function AgentCheckboxes({
  value,
  onChange,
  suggested = [],
  legend = "Assign to",
  name,
}: {
  value: AgentKey[];
  onChange: (next: AgentKey[]) => void;
  suggested?: AgentKey[];
  legend?: string;
  /** Form field name: each checked agent is submitted as one value. */
  name?: string;
}) {
  const toggle = (key: AgentKey) => onChange(value.includes(key) ? value.filter((k) => k !== key) : AGENT_KEYS.filter((k) => k === key || value.includes(k)));
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {AGENT_KEYS.map((key) => {
          const checked = value.includes(key);
          return (
            <label
              key={key}
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked && "border-brand/40 bg-brand/5 hover:bg-brand/10"
              )}
            >
              <input type="checkbox" className="sr-only" name={name} value={key} checked={checked} onChange={() => toggle(key)} />
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border border-input bg-card transition-colors",
                  checked && "border-primary bg-primary text-primary-foreground"
                )}
              >
                {checked && <CheckIcon className="size-3" strokeWidth={3} />}
              </span>
              <AgentPortrait agent={agentOf(key)} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{AGENT_ROLES[key].name}</span>
                <span className="truncate text-xs text-muted-foreground">{suggested.includes(key) ? "Suggested" : AGENT_ROLES[key].role}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
