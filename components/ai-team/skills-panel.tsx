"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { LibraryBigIcon, TriangleAlertIcon } from "lucide-react";

import { setAgentSkillAction } from "@/app/dashboard/[workspaceId]/ai-team/actions";
import { SkillBadges } from "@/components/skills/skill-badges";
import { Switch } from "@/components/ui/switch";
import { AGENT_ROLES, PERMISSION_BY_ID, type AgentKey, type PermissionId } from "@/lib/agent-config";
import type { SkillView } from "@/lib/agent-skills-config";
import type { AgentView } from "@/lib/agents";

/**
 * Configure → Skills: the workspace's skills with a switch for this agent. Saves at once (not with the dialog's
 * Save), like the auto-failover toggle. Recommended skills for the role come first. Uploading lives in Settings.
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
  const recommended = skills.filter((s) => s.roles.includes(agent.id));
  const others = skills.filter((s) => !s.roles.includes(agent.id));
  const on = skills.filter((s) => agent.skillIds.includes(s.id)).length;

  return (
    <section className="surface flex flex-col" aria-labelledby="skills-title">
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3.5">
        <LibraryBigIcon className="size-4 text-brand-emphasis" />
        <h3 id="skills-title" className="text-sm font-bold">
          Skills
        </h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{on} on</span>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <p className="text-xs text-muted-foreground">
          Knowledge the {agent.name} reads while it works. Switches save right away and apply from its next turn.
        </p>
        {!skills.length && <p className="text-sm text-muted-foreground">No skills in this workspace yet.</p>}
        {recommended.length > 0 && (
          <SkillGroup label={`Recommended for the ${agent.name}`} skills={recommended} agent={agent} permissions={permissions} workspaceId={workspaceId} />
        )}
        {others.length > 0 && <SkillGroup label="Other skills" skills={others} agent={agent} permissions={permissions} workspaceId={workspaceId} showFit />}
        <Link href={`/dashboard/${workspaceId}/settings#skills`} className="text-xs font-medium text-brand-emphasis hover:underline">
          Manage skills
        </Link>
      </div>
    </section>
  );
}

function SkillGroup({
  label,
  skills,
  agent,
  permissions,
  workspaceId,
  showFit = false,
}: {
  label: string;
  skills: SkillView[];
  agent: AgentView;
  permissions: PermissionId[];
  workspaceId: number;
  showFit?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <ul className="flex flex-col divide-y divide-border/70">
        {skills.map((skill) => (
          <SkillToggle
            key={skill.id}
            skill={skill}
            agent={agent}
            permissions={permissions}
            workspaceId={workspaceId}
            fit={showFit && skill.roles.length ? skill.roles.map((key: AgentKey) => AGENT_ROLES[key].name).join(", ") : null}
          />
        ))}
      </ul>
    </div>
  );
}

function SkillToggle({
  skill,
  agent,
  permissions,
  workspaceId,
  fit,
}: {
  skill: SkillView;
  agent: AgentView;
  permissions: PermissionId[];
  workspaceId: number;
  fit: string | null;
}) {
  const [enabled, setEnabled] = useOptimistic(agent.skillIds.includes(skill.id));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const missing = skill.requires.filter((p) => !permissions.includes(p));

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setEnabled(next);
      setError(null);
      const result = await setAgentSkillAction(workspaceId, agent.id, skill.id, next);
      if (!result.ok) setError(result.error);
    });

  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold" title={skill.description}>
            {skill.name}
          </span>
          <SkillBadges skill={skill} />
          {fit && <p className="text-xs text-muted-foreground">Fits: {fit}</p>}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={pending}
          aria-label={`Use the ${skill.name} skill for the ${agent.name}`}
          className="mt-0.5"
        />
      </div>
      {enabled && missing.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            Assumes the {missing.map((p) => PERMISSION_BY_ID[p].name).join(", ")} permission{missing.length === 1 ? "" : "s"}, which the {agent.name}{" "}
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
