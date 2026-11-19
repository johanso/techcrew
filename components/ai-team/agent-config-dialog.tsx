"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckIcon, RotateCcwIcon, SaveIcon, SparklesIcon, Undo2Icon } from "lucide-react";

import { generateAgentAction, saveAgentAction } from "@/app/dashboard/[workspaceId]/ai-team/actions";
import { AGENT_STATUS, AgentPortrait } from "@/components/ai-team/agent-visuals";
import { SkillsPanel } from "@/components/ai-team/skills-panel";
import { SpendingPanel } from "@/components/ai-team/spending-panel";
import { TrustPanel } from "@/components/ai-team/trust-panel";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_ROLES,
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  BUDGET_PRESETS_USD,
  DESCRIPTION_MAX,
  INSTRUCTIONS_MAX,
  PROVIDERS,
  PERMISSION_CATEGORIES,
  PERMISSIONS,
  agentModelFor,
  formatMicros,
  isAgentModelId,
  isAgentProvider,
  modelInfo,
  modelsFor,
  type AgentModelId,
  type AgentProvider,
  type ProviderStatus,
  type PermissionId,
  type PermissionRisk,
} from "@/lib/agent-config";
import { MAX_TURNS_MAX, MAX_TURNS_MIN } from "@/lib/agent-run-config";
import type { AgentConfigField, AgentView } from "@/lib/agents";
import type { SkillView } from "@/lib/agent-skills-config";
import type { SwitchTrustStatus } from "@/lib/switch-trust-config";
import { cn } from "@/lib/utils";

const PROVIDER_IDS = Object.keys(PROVIDERS) as AgentProvider[];

const RISK: Record<PermissionRisk, { label: string; dot: string; text: string }> = {
  low: { label: "Low risk", dot: "bg-success", text: "text-muted-foreground" },
  medium: { label: "Medium risk", dot: "bg-action", text: "text-muted-foreground" },
  high: { label: "High risk", dot: "bg-warning", text: "text-foreground" },
  critical: { label: "Critical", dot: "bg-error", text: "text-error" },
};

const samePermissions = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s) => b.includes(s));

export function AgentConfigDialog({
  open,
  onOpenChange,
  agent,
  workspaceId,
  repoFullName,
  aiEnabled,
  providers,
  switchTrust,
  skills,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentView;
  workspaceId: number;
  repoFullName: string;
  aiEnabled: boolean;
  providers: ProviderStatus;
  switchTrust: SwitchTrustStatus;
  /** The workspace's skill library (Settings → Agent skills). */
  skills: SkillView[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* overflow-clip, not hidden: a hidden box can still be scrolled by focus/scrollIntoView, shifting header and footer. */}
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-clip p-0 sm:max-w-5xl">
        <ConfigForm
          agent={agent}
          workspaceId={workspaceId}
          repoFullName={repoFullName}
          aiEnabled={aiEnabled}
          providers={providers}
          switchTrust={switchTrust}
          skills={skills}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConfigForm({
  agent,
  workspaceId,
  repoFullName,
  aiEnabled,
  providers,
  switchTrust,
  skills,
  onSaved,
}: {
  agent: AgentView;
  workspaceId: number;
  repoFullName: string;
  aiEnabled: boolean;
  providers: ProviderStatus;
  switchTrust: SwitchTrustStatus;
  /** The workspace's skill library (Settings → Agent skills). */
  skills: SkillView[];
  onSaved: () => void;
}) {
  const defaults = AGENT_ROLES[agent.id].defaults;
  const [enabled, setEnabled] = useState(agent.enabled);
  const [description, setDescription] = useState(agent.description);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [model, setModel] = useState<AgentModelId>(agent.model);
  // The company follows the model: changing it in the Company select picks that company's closest model.
  const provider = modelInfo(model).provider;
  const [permissions, setPermissions] = useState<PermissionId[]>(agent.permissions);
  const [budget, setBudget] = useState(String(agent.monthlyBudgetCents / 100));
  const [maxTurns, setMaxTurns] = useState(String(agent.maxTurns));
  const [errors, setErrors] = useState<Partial<Record<AgentConfigField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const budgetUsd = Number(budget);
  const budgetCents = Number.isFinite(budgetUsd) && budgetUsd > 0 ? Math.round(budgetUsd * 100) : agent.monthlyBudgetCents;
  const dirty =
    enabled !== agent.enabled ||
    description.trim() !== agent.description ||
    instructions.trim() !== agent.instructions ||
    model !== agent.model ||
    !samePermissions(permissions, agent.permissions) ||
    budgetCents !== agent.monthlyBudgetCents ||
    Number(maxTurns) !== agent.maxTurns;

  const clearError = (field: AgentConfigField) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    startSaving(async () => {
      const result = await saveAgentAction(workspaceId, agent.id, {
        enabled,
        description,
        instructions,
        model,
        permissions,
        monthlyBudgetUsd: budget.trim() === "" ? Number.NaN : budgetUsd,
        maxTurns: maxTurns.trim() === "" ? Number.NaN : Number(maxTurns),
      });
      if (result.ok) return onSaved();
      setErrors(("errors" in result && result.errors) || {});
      setFormError(result.error);
    });
  };

  const status = AGENT_STATUS[agent.status];

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border/70 px-6 py-5 pr-14">
        <AgentPortrait agent={agent} status={agent.status} size="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="eyebrow text-brand-emphasis">Configure agent</p>
          <DialogTitle className="truncate text-lg font-bold">{agent.name}</DialogTitle>
          <DialogDescription className="truncate">
            {agent.role} · {status.label} · works on {repoFullName}
          </DialogDescription>
        </div>
      </div>

      {/* Body: form + insights */}
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-7 px-6 py-6">
          <FormMessage message={formError ?? undefined} />

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-muted/50 px-4 py-3 ring-1 ring-border/60">
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">{enabled ? "Active" : "Paused"}</span>
              <span className="text-xs text-muted-foreground">
                {enabled ? "Picks up cards you run from the board." : "Won't pick up new work until you resume it."}
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Agent active" />
          </label>

          <Field data-invalid={!!errors.description}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="agent-description">Description</FieldLabel>
              <span className="text-xs text-muted-foreground tabular-nums">
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <Textarea
              id="agent-description"
              rows={2}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => {
                setDescription(event.target.value);
                clearError("description");
              }}
              aria-invalid={!!errors.description}
              className="resize-none"
            />
            <FieldError>{errors.description}</FieldError>
          </Field>

          <InstructionsField
            agent={agent}
            workspaceId={workspaceId}
            repoFullName={repoFullName}
            aiEnabled={aiEnabled}
            instructions={instructions}
            description={description}
            permissions={permissions}
            budgetUsd={budgetCents / 100}
            error={errors.instructions}
            onChange={(next) => {
              if (next.instructions !== undefined) setInstructions(next.instructions);
              if (next.description !== undefined) setDescription(next.description);
              clearError("instructions");
              if (next.description !== undefined) clearError("description");
            }}
            onReset={() => {
              setInstructions(defaults.instructions);
              clearError("instructions");
            }}
          />

          <PermissionPicker
            value={permissions}
            defaults={defaults.permissions}
            roleName={agent.name}
            error={errors.permissions}
            onChange={(next) => {
              setPermissions(next);
              clearError("permissions");
            }}
          />

          <div className="grid gap-6 border-t border-border/70 pt-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="agent-provider">Company</FieldLabel>
              <Select
                items={PROVIDER_IDS.map((id) => ({ value: id, label: providers[id] ? PROVIDERS[id].label : `${PROVIDERS[id].label} (no key)` }))}
                value={provider}
                onValueChange={(value) => {
                  // Moving company keeps the tier: the closest model there (GPT-6.1 Sol ↔ Claude Sonnet 5.5, …).
                  if (isAgentProvider(value) && value !== provider) setModel(agentModelFor(agent.id, value, model, {}));
                  clearError("model");
                }}
              >
                <SelectTrigger id="agent-provider" className="w-full data-[size=default]:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      <span className="flex w-full items-baseline justify-between gap-3">
                        <span className="font-medium">{PROVIDERS[id].label}</span>
                        {!providers[id] && <span className="text-xs text-muted-foreground">No key</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {providers[provider] ? (
                  <>Each agent can work on a different company.</>
                ) : (
                  <>
                    No {PROVIDERS[provider].label} key yet:{" "}
                    <Link href={`/dashboard/${workspaceId}/settings#keys`} className="font-medium text-brand-emphasis hover:underline">
                      add one in Settings
                    </Link>{" "}
                    to run this agent.
                  </>
                )}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.model}>
              <FieldLabel htmlFor="agent-model">Model</FieldLabel>
              <Select
                items={modelsFor(provider).map((m) => ({ value: m.id, label: m.label }))}
                value={model}
                onValueChange={(value) => {
                  if (isAgentModelId(value)) setModel(value);
                  clearError("model");
                }}
              >
                <SelectTrigger id="agent-model" className="w-full data-[size=default]:h-10">
                  <SelectValue />
                </SelectTrigger>
                {/* Wider than the half-width trigger and below it, so names, prices and hints fit; hints may wrap. */}
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  className="w-auto max-w-[min(26rem,calc(100vw-2rem))] min-w-(--anchor-width)"
                >
                  <SelectGroup>
                    {/* pr-8 lines the price header up with the prices (items leave room for the check). */}
                    <SelectLabel className="flex justify-between gap-3 pr-8">
                      <span>{PROVIDERS[provider].label} models</span>
                      <span>per 1M tokens · in / out</span>
                    </SelectLabel>
                    {modelsFor(provider).map((m) => (
                      <SelectItem key={m.id} value={m.id} className="py-2">
                        <span className="flex w-full min-w-0 flex-col gap-0.5 whitespace-normal">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="font-medium">{m.label}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              ${m.pricing.input} / ${m.pricing.output}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">{m.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{modelInfo(model).hint}</FieldDescription>
              <FieldError>{errors.model}</FieldError>
            </Field>

            <Field data-invalid={!!errors.budget}>
              <FieldLabel htmlFor="agent-budget">Monthly budget</FieldLabel>
              <InputGroup className="h-10">
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput
                  id="agent-budget"
                  type="number"
                  inputMode="decimal"
                  min={BUDGET_MIN_USD}
                  max={BUDGET_MAX_USD}
                  step="1"
                  value={budget}
                  onChange={(event) => {
                    setBudget(event.target.value);
                    clearError("budget");
                  }}
                  aria-invalid={!!errors.budget}
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">/ month</InputGroupAddon>
              </InputGroup>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Budget presets">
                {BUDGET_PRESETS_USD.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={budgetUsd === preset}
                    onClick={() => {
                      setBudget(String(preset));
                      clearError("budget");
                    }}
                    className={cn("tabular-nums", budgetUsd === preset && "border-brand/40 bg-brand/5 text-brand-emphasis")}
                  >
                    ${preset}
                  </Button>
                ))}
              </div>
              <FieldError>{errors.budget}</FieldError>
            </Field>

            <Field data-invalid={!!errors.maxTurns}>
              <FieldLabel htmlFor="agent-max-turns">Max turns per stage</FieldLabel>
              <InputGroup className="h-10">
                <InputGroupInput
                  id="agent-max-turns"
                  type="number"
                  inputMode="numeric"
                  min={MAX_TURNS_MIN}
                  max={MAX_TURNS_MAX}
                  step="1"
                  value={maxTurns}
                  onChange={(event) => {
                    setMaxTurns(event.target.value);
                    clearError("maxTurns");
                  }}
                  aria-invalid={!!errors.maxTurns}
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">turns</InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                Model calls the agent may make on one card before it must hand in its result. Default for the {agent.name}:{" "}
                {defaults.maxTurns}.
              </FieldDescription>
              <FieldError>{errors.maxTurns}</FieldError>
            </Field>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 border-t border-border/70 bg-canvas px-5 py-6 lg:border-t-0 lg:border-l">
          <TrustPanel agent={agent} workspaceId={workspaceId} dirty={dirty} aiEnabled={aiEnabled} switchTrust={switchTrust} />
          <SpendingPanel spend={agent.spend} budgetCents={budgetCents} />
          <SkillsPanel agent={agent} skills={skills} permissions={permissions} workspaceId={workspaceId} />
        </aside>
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-3 border-t border-border/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span aria-hidden className={cn("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-success")} />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        <div className="flex gap-2">
          <DialogClose render={<Button type="button" variant="outline" className="h-10 flex-1 sm:flex-none" />}>Cancel</DialogClose>
          <Button type="submit" className="h-10 flex-1 sm:flex-none" disabled={saving || !dirty}>
            {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Instructions textarea with "Draft with AI" and an undo for the last draft. */
function InstructionsField({
  agent,
  workspaceId,
  repoFullName,
  aiEnabled,
  instructions,
  description,
  permissions,
  budgetUsd,
  error,
  onChange,
  onReset,
}: {
  agent: AgentView;
  workspaceId: number;
  repoFullName: string;
  aiEnabled: boolean;
  instructions: string;
  description: string;
  permissions: PermissionId[];
  budgetUsd: number;
  error?: string;
  onChange: (next: { instructions?: string; description?: string }) => void;
  onReset: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [focus, setFocus] = useState("");
  const [generating, startGenerating] = useTransition();
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ costMicros: number; repoAware: boolean; previous: { instructions: string; description: string } } | null>(null);
  const isDefault = instructions.trim() === AGENT_ROLES[agent.id].defaults.instructions;

  const generate = () => {
    setDraftError(null);
    startGenerating(async () => {
      const result = await generateAgentAction(workspaceId, agent.id, { permissions, monthlyBudgetUsd: budgetUsd, focus });
      if (!result.ok) return setDraftError(result.error);
      setDraft({ costMicros: result.costMicros, repoAware: result.repoAware, previous: { instructions, description } });
      onChange({ instructions: result.instructions, description: result.description });
      setComposing(false);
    });
  };

  return (
    <Field data-invalid={!!error} className="border-t border-border/70 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
        <div className="flex items-center gap-1">
          {!isDefault && (
            <Button type="button" variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
              <RotateCcwIcon data-icon="inline-start" />
              Reset to default
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setComposing((v) => !v)}
            disabled={!aiEnabled || generating}
            aria-expanded={composing}
            title={aiEnabled ? undefined : "Add an API key in Settings → AI providers to enable"}
          >
            <SparklesIcon data-icon="inline-start" className="text-brand-emphasis" />
            Draft with AI
          </Button>
        </div>
      </div>

      {!aiEnabled && (
        <FieldDescription>
          AI drafting is off. Add an OpenAI or Anthropic API key in Settings → AI providers to tailor these instructions to {repoFullName}.
        </FieldDescription>
      )}

      {composing && (
        <div className="flex flex-col gap-3 rounded-lg bg-brand/5 p-4 ring-1 ring-brand/15 animate-in fade-in">
          <div className="flex gap-3">
            <SparklesIcon className="mt-0.5 size-4 shrink-0 text-brand-emphasis" />
            <p className="text-xs text-muted-foreground">
              AI writes a description and instructions for the <span className="font-semibold text-foreground">{agent.name}</span>,
              tailored to <span className="font-semibold text-foreground">{repoFullName}</span> and the permissions and budget below. Nothing is
              saved until you review it and click Save.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="Anything to emphasize? e.g. accessibility, our API conventions"
              aria-label="What to emphasize (optional)"
              maxLength={300}
              className="h-9 bg-card"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  generate();
                }
              }}
            />
            <Button type="button" className="h-9 shrink-0" onClick={generate} disabled={generating}>
              {generating ? <Spinner /> : <SparklesIcon data-icon="inline-start" />}
              {generating ? "Drafting…" : "Generate"}
            </Button>
          </div>
          {draftError && <p className="text-xs font-medium text-error">{draftError}</p>}
        </div>
      )}

      {draft && !composing && (
        <div className="flex items-center gap-3 rounded-lg bg-success/10 px-3.5 py-2.5 text-xs ring-1 ring-success/20">
          <CheckIcon className="size-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1">
            AI draft ready{draft.repoAware ? ` for ${repoFullName}` : ""}. Review it, then save.{" "}
            <span className="text-muted-foreground tabular-nums">Cost {formatMicros(draft.costMicros)}.</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(draft.previous);
              setDraft(null);
            }}
          >
            <Undo2Icon data-icon="inline-start" />
            Undo
          </Button>
        </div>
      )}

      <Textarea
        id="agent-instructions"
        rows={14}
        value={instructions}
        maxLength={INSTRUCTIONS_MAX}
        onChange={(event) => onChange({ instructions: event.target.value })}
        aria-invalid={!!error}
        aria-busy={generating}
        className={cn("min-h-72 resize-y leading-relaxed transition-opacity", generating && "opacity-50")}
      />
      <div className="flex items-center justify-between gap-2">
        <FieldError>{error}</FieldError>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {instructions.length.toLocaleString()}/{INSTRUCTIONS_MAX.toLocaleString()}
        </span>
      </div>
    </Field>
  );
}

/** Permissions grouped by category as checkbox cards; the role's defaults are tagged and restorable. */
function PermissionPicker({
  value,
  defaults,
  roleName,
  error,
  onChange,
}: {
  value: PermissionId[];
  defaults: PermissionId[];
  roleName: string;
  error?: string;
  onChange: (next: PermissionId[]) => void;
}) {
  const isDefault = samePermissions(value, defaults);
  const toggle = (id: PermissionId) => onChange(value.includes(id) ? value.filter((s) => s !== id) : [...value, id]);

  return (
    <fieldset className="flex flex-col gap-4 border-t border-border/70 pt-6" aria-describedby="permissions-hint">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <legend className="text-sm font-medium">
            Permissions <span className="text-muted-foreground tabular-nums">· {value.length} granted</span>
          </legend>
          <p id="permissions-hint" className="text-xs text-muted-foreground">
            What the {roleName} may do, enforced as tools. Each permission raises the trust scan&apos;s risk weight.
          </p>
        </div>
        {!isDefault && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaults)} className="text-muted-foreground">
            <RotateCcwIcon data-icon="inline-start" />
            Reset to defaults
          </Button>
        )}
      </div>

      {PERMISSION_CATEGORIES.map((category) => (
        <div key={category.id} className="flex flex-col gap-2">
          <p className="eyebrow text-muted-foreground">{category.label}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.filter((s) => s.category === category.id).map((permission) => {
              const checked = value.includes(permission.id);
              const risk = RISK[permission.risk];
              return (
                <label
                  key={permission.id}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                    checked && "border-brand/40 bg-brand/5 hover:bg-brand/10"
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(permission.id)} />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-input bg-card transition-colors",
                      checked && "border-primary bg-primary text-primary-foreground"
                    )}
                  >
                    {checked && <CheckIcon className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{permission.name}</span>
                      {defaults.includes(permission.id) && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground ring-1 ring-border/70">
                          Default
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{permission.description}</span>
                    <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", risk.text)}>
                      <span aria-hidden className={cn("size-1.5 rounded-full", risk.dot)} />
                      {risk.label}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </fieldset>
  );
}
