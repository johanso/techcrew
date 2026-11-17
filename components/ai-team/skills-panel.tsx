"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LibraryBigIcon, PlusIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { setAgentSkillAction } from "@/app/dashboard/[workspaceId]/ai-team/actions";
import { SkillBadges } from "@/components/skills/skill-badges";
import { matchesSkillQuery } from "@/components/skills/skill-filters";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { PERMISSION_BY_ID, type PermissionId } from "@/lib/agent-config";
import type { SkillView } from "@/lib/agent-skills-config";
import type { AgentView } from "@/lib/agents";

/** Search results shown at once; the rest are reached by refining the search. */
const ADD_RESULTS = 8;

/**
 * Configure → Skills: only the skills this agent has on, each with a switch, plus "Add a skill" to search the rest of
 * the library. Saves at once (not with the dialog's Save), like the auto-failover toggle. A skill switched off here
 * stays listed until the dialog closes, so it can be switched back. Uploading lives in Settings → Agent skills.
 */
export function SkillsPanel({
  agent,
  skills,
  permissions,
  workspaceId,
}: {
  agent: AgentView;
  skills: SkillView[];
  /** The dialog's draft permissions, so the "needs a permission" warning follows unsaved edits. */
  permissions: PermissionId[];
  workspaceId: number;
}) {
  const [on, setOn] = useState<number[]>(agent.skillIds);
  const [listed, setListed] = useState<number[]>(agent.skillIds);
  const [pending, setPending] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);

  const save = async (skill: SkillView, enabled: boolean) => {
    setOn((ids) => (enabled ? [...ids, skill.id] : ids.filter((id) => id !== skill.id)));
    setPending((ids) => [...ids, skill.id]);
    setErrors(({ [skill.id]: _dropped, ...rest }) => rest);
    const result = await setAgentSkillAction(workspaceId, agent.id, skill.id, enabled);
    setPending((ids) => ids.filter((id) => id !== skill.id));
    if (!result.ok) {
      setOn((ids) => (enabled ? ids.filter((id) => id !== skill.id) : [...ids, skill.id]));
      setErrors((current) => ({ ...current, [skill.id]: result.error }));
    }
  };

  const add = (skill: SkillView) => {
    setListed((ids) => [...ids, skill.id]);
    void save(skill, true);
  };

  const shown = skills.filter((s) => listed.includes(s.id));
  const available = skills.filter((s) => !listed.includes(s.id));

  return (
    <section className="surface flex flex-col" aria-labelledby="skills-title">
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3.5">
        <LibraryBigIcon className="size-4 text-brand-emphasis" />
        <h3 id="skills-title" className="text-sm font-bold">
          Skills
        </h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{on.length} on</span>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <p className="text-xs text-muted-foreground">
          Knowledge the {agent.name} reads while it works. Changes save right away and apply from its next turn.
        </p>

        {shown.length ? (
          <ul className="flex flex-col divide-y divide-border/70" aria-label={`Skills of the ${agent.name}`}>
            {shown.map((skill) => (
              <SkillToggle
                key={skill.id}
                skill={skill}
                agentName={agent.name}
                enabled={on.includes(skill.id)}
                pending={pending.includes(skill.id)}
                error={errors[skill.id] ?? null}
                permissions={permissions}
                onChange={(next) => void save(skill, next)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No skills on for the {agent.name} yet.</p>
        )}

        {adding ? (
          <SkillPicker agent={agent} skills={available} onAdd={add} onClose={() => setAdding(false)} />
        ) : available.length ? (
          <Button type="button" variant="outline" className="h-9 self-start" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" />
            Add a skill
          </Button>
        ) : skills.length ? (
          <p className="text-xs text-muted-foreground">Every skill in the workspace is listed here.</p>
        ) : null}

        <Link href={`/dashboard/${workspaceId}/settings/skills`} className="text-xs font-medium text-brand-emphasis hover:underline">
          Manage skills
        </Link>
      </div>
    </section>
  );
}

/** Search the skills this agent doesn't have yet; the ones recommended for its role come first. */
function SkillPicker({ agent, skills, onAdd, onClose }: { agent: AgentView; skills: SkillView[]; onAdd: (skill: SkillView) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const recommended = (skill: SkillView) => skill.roles.includes(agent.id);
  const matches = skills
    .filter((skill) => matchesSkillQuery(skill, query))
    .sort((a, b) => Number(recommended(b)) - Number(recommended(a)));
  const results = matches.slice(0, ADD_RESULTS);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3 ring-1 ring-border/60">
      <div className="flex items-center gap-2">
        <InputGroup className="h-9 bg-card">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Escape clears the search first, then closes the picker; never the whole dialog.
              event.preventDefault();
              event.stopPropagation();
              if (query) setQuery("");
              else onClose();
            }}
            placeholder="Search skills to add"
            aria-label={`Search skills to add to the ${agent.name}`}
            className="[&::-webkit-search-cancel-button]:hidden"
          />
        </InputGroup>
        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Close skill search" onClick={onClose}>
          <XIcon />
        </Button>
      </div>

      {results.length ? (
        <ul className="flex flex-col divide-y divide-border/70" aria-label="Skills you can add">
          {results.map((skill) => (
            <li key={skill.id} className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold" title={skill.description}>
                    {skill.name}
                  </span>
                  {recommended(skill) && (
                    <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-emphasis">Recommended</span>
                  )}
                </span>
                <p className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onAdd(skill)} aria-label={`Add ${skill.name}`}>
                <PlusIcon data-icon="inline-start" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{query ? `No skills match “${query}”.` : "No other skills in the library."}</p>
      )}
      {matches.length > results.length && (
        <p className="text-xs text-muted-foreground">
          {matches.length - results.length} more match. Refine the search to see them.
        </p>
      )}
    </div>
  );
}

function SkillToggle({
  skill,
  agentName,
  enabled,
  pending,
  error,
  permissions,
  onChange,
}: {
  skill: SkillView;
  agentName: string;
  enabled: boolean;
  pending: boolean;
  error: string | null;
  permissions: PermissionId[];
  onChange: (next: boolean) => void;
}) {
  const missing = skill.requires.filter((p) => !permissions.includes(p));

  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold" title={skill.description}>
            {skill.name}
          </span>
          <SkillBadges skill={skill} />
        </div>
        {pending && <Spinner className="mt-1 size-3.5 text-muted-foreground" />}
        <Switch
          checked={enabled}
          onCheckedChange={onChange}
          disabled={pending}
          aria-label={`Use the ${skill.name} skill for the ${agentName}`}
          className="mt-0.5"
        />
      </div>
      {enabled && missing.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            Assumes the {missing.map((p) => PERMISSION_BY_ID[p].name).join(", ")} permission{missing.length === 1 ? "" : "s"}, which the {agentName}{" "}
            doesn&apos;t have.
          </span>
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
