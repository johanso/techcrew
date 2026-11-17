"use client";

import { useState, useTransition } from "react";
import { ExternalLinkIcon, SearchIcon, Trash2Icon, UploadIcon, UsersIcon, XIcon } from "lucide-react";

import { deleteSkillAction, saveSkillAssignmentsAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { AgentCheckboxes } from "@/components/skills/agent-checkboxes";
import { SkillAgents, SkillBadges, SkillScanChip } from "@/components/skills/skill-badges";
import {
  filterSkills,
  isFilteringSkills,
  isSkillAgentFilter,
  NO_SKILL_FILTERS,
  type SkillAgentFilter,
  type SkillFilters,
} from "@/components/skills/skill-filters";
import { SkillFindings } from "@/components/skills/skill-findings";
import { SkillUpload } from "@/components/skills/skill-upload";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_KEYS, AGENT_ROLES, type AgentKey } from "@/lib/agent-config";
import { formatBytes, type SkillView } from "@/lib/agent-skills-config";

const AGENT_FILTER_ITEMS: { value: SkillAgentFilter; label: string }[] = [
  { value: "all", label: "All agents" },
  ...AGENT_KEYS.map((key) => ({ value: key, label: `On for the ${AGENT_ROLES[key].name}` })),
  { value: "none", label: "Not used by any agent" },
];

/**
 * Settings → Agent skills: the library (built-ins first) with search and an agent filter. Each skill shows what it
 * is, where it came from, its scan and who has it on; actions change assignments, upload a new version or delete
 * (uploaded only).
 */
export function SkillLibrary({ workspaceId, skills }: { workspaceId: number; skills: SkillView[] }) {
  const [filters, setFilters] = useState<SkillFilters>(NO_SKILL_FILTERS);
  const [assigning, setAssigning] = useState<SkillView | null>(null);
  const [versioning, setVersioning] = useState<SkillView | null>(null);
  const [deleting, setDeleting] = useState<SkillView | null>(null);
  const visible = filterSkills(skills, filters);
  const filtering = isFilteringSkills(filters);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:px-6">
        <InputGroup className="h-10 bg-card sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filters.query) {
                event.preventDefault();
                setFilters({ ...filters, query: "" });
              }
            }}
            placeholder="Search skills"
            aria-label="Search skills by name, description or origin"
            className="[&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setFilters({ ...filters, query: "" })}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Select items={AGENT_FILTER_ITEMS} value={filters.agent} onValueChange={(value) => isSkillAgentFilter(value) && setFilters({ ...filters, agent: value })}>
          <SelectTrigger aria-label="Filter by agent" className="w-full data-[size=default]:h-10 sm:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground sm:ml-auto" role="status">
          {filtering ? (
            <>
              <span className="font-semibold text-foreground tabular-nums">{visible.length}</span> of <span className="tabular-nums">{skills.length}</span> skills
            </>
          ) : (
            <>
              <span className="tabular-nums">{skills.length}</span> skill{skills.length === 1 ? "" : "s"}
            </>
          )}
        </p>
      </div>
      {visible.length ? (
        <ul className="flex flex-col divide-y divide-border/70" aria-label="Skill library">
          {visible.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onAssign={() => setAssigning(skill)}
              onNewVersion={() => setVersioning(skill)}
              onDelete={() => setDeleting(skill)}
            />
          ))}
        </ul>
      ) : skills.length ? (
        <div className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-muted-foreground">No skills match these filters.</p>
          <Button type="button" variant="outline" className="h-9" onClick={() => setFilters(NO_SKILL_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">No skills yet. Upload one to get started.</p>
      )}

      {assigning && <AssignDialog key={assigning.id} workspaceId={workspaceId} skill={assigning} onClose={() => setAssigning(null)} />}
      <Dialog open={versioning !== null} onOpenChange={(open) => !open && setVersioning(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New version of {versioning?.name}</DialogTitle>
            <DialogDescription>It must keep the name {versioning?.slug}. It&apos;s scanned again before it replaces the installed files.</DialogDescription>
          </DialogHeader>
          {versioning && (
            <SkillUpload
              key={versioning.id}
              workspaceId={workspaceId}
              replace={{ id: versioning.id, name: versioning.name }}
              currentRoles={versioning.enabledFor}
              onClose={() => setVersioning(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {deleting && <DeleteDialog key={deleting.id} workspaceId={workspaceId} skill={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function SkillRow({ skill, onAssign, onNewVersion, onDelete }: { skill: SkillView; onAssign: () => void; onNewVersion: () => void; onDelete: () => void }) {
  const uploaded = skill.source === "uploaded";
  return (
    <li className="flex min-w-0 flex-col gap-4 p-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-sm font-bold">{skill.name}</h3>
          <SkillBadges skill={skill} />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground" title={skill.description}>
          {skill.description}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {skill.url ? (
            <a href={skill.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-emphasis hover:underline">
              {skill.origin}
              <ExternalLinkIcon aria-hidden className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span>{skill.origin}</span>
          )}
          {skill.license && <span>{skill.license}</span>}
          <span className="tabular-nums">
            {skill.fileCount} file{skill.fileCount === 1 ? "" : "s"} · {formatBytes(skill.totalBytes)}
          </span>
          <SkillScanChip scan={skill.scan} />
        </p>
        {skill.scan && skill.scan.findings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Show scan findings</summary>
            <SkillFindings findings={skill.scan.findings} className="mt-2" />
          </details>
        )}
        <SkillAgents keys={skill.enabledFor} empty="Not switched on for any agent" />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-9" onClick={onAssign}>
          <UsersIcon data-icon="inline-start" />
          Assign
        </Button>
        {uploaded && (
          <>
            <Button type="button" variant="outline" className="h-9" onClick={onNewVersion}>
              <UploadIcon data-icon="inline-start" />
              New version
            </Button>
            <Button type="button" variant="ghost" className="h-9 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function AssignDialog({ workspaceId, skill, onClose }: { workspaceId: number; skill: SkillView; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [roles, setRoles] = useState<AgentKey[]>(skill.enabledFor);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const close = () => {
    setOpen(false);
    onClose();
  };
  const save = () =>
    startSaving(async () => {
      setError(null);
      const result = await saveSkillAssignmentsAction(workspaceId, skill.id, roles);
      if (result.ok) close();
      else setError(result.error);
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && close()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Who uses {skill.name}?</DialogTitle>
          <DialogDescription>
            Checked agents read it while they work, from their next turn. {skill.source === "builtin" ? "Built-in skills can't be deleted, only switched off." : ""}
          </DialogDescription>
        </DialogHeader>
        <AgentCheckboxes value={roles} onChange={setRoles} suggested={skill.roles} legend="Switched on for" />
        <FormMessage message={error ?? undefined} />
        <DialogFooter>
          <Button type="button" variant="outline" className="h-10" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="h-10" onClick={save} disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ workspaceId, skill, onClose }: { workspaceId: number; skill: SkillView; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const close = () => {
    setOpen(false);
    onClose();
  };
  const remove = () =>
    startRemoving(async () => {
      setError(null);
      const result = await deleteSkillAction(workspaceId, skill.id);
      if (result.ok) close();
      else setError(result.error);
    });

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !removing && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {skill.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {skill.enabledFor.length
              ? `${skill.enabledFor.length} agent${skill.enabledFor.length === 1 ? "" : "s"} use it; they stop reading it from their next turn. `
              : ""}
            Its files are removed from this workspace. You can upload it again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormMessage message={error ?? undefined} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove} disabled={removing}>
            {removing && <Spinner />}
            {removing ? "Deleting…" : "Delete skill"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
