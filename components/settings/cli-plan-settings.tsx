"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRightIcon, BadgeCheckIcon, CircleAlertIcon, HourglassIcon, KeyRoundIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";

import { claudePlanAction, savePlanLimitAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { OptionCards, type OptionCard } from "@/components/settings/option-cards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CLI_META, PLAN_LIMIT_POLICY_META, type ClaudePlanView, type PlanLimitPolicy } from "@/lib/cli-agents-config";

const POLICY_ICON: Record<PlanLimitPolicy, OptionCard<PlanLimitPolicy>["icon"]> = { wait: HourglassIcon, api: KeyRoundIcon, failover: ArrowLeftRightIcon };

const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Settings → AI → Plans on this computer: Claude Code under TechTeam's own config home. The owner signs in once with
 * their personal account, confirms it, and switches the plan on; Claude models then run on the plan on this computer
 * (agents keep their model). Shown only when TechTeam runs locally.
 */
export function ClaudePlanSettings({ workspaceId, initial }: { workspaceId: number; initial: ClaudePlanView }) {
  const [view, setView] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const meta = CLI_META.claude;

  const run = (op: "sign_in" | "sign_out" | "check" | "confirm" | "enable" | "disable") =>
    startTransition(async () => {
      setBusy(op);
      setError(null);
      setMessage(null);
      const result = await claudePlanAction(workspaceId, op);
      setBusy(null);
      if (!result.ok) return setError(result.error);
      if (result.view) setView(result.view);
      if (result.message) setMessage(result.message);
    });

  const choosePolicy = (policy: PlanLimitPolicy) =>
    startTransition(async () => {
      const previous = view.onLimit;
      setView((current) => ({ ...current, onLimit: policy }));
      setError(null);
      const result = await savePlanLimitAction(workspaceId, policy);
      if (!result.ok) {
        setView((current) => ({ ...current, onLimit: previous }));
        setError(result.error);
      }
    });

  const signedIn = Boolean(view.auth?.loggedIn);
  const canEnable = view.installed && !view.problem && signedIn && Boolean(view.auth?.isPlan) && view.accountConfirmed;
  const policies: OptionCard<PlanLimitPolicy>[] = (["wait", "api", "failover"] as const).map((value) => ({
    value,
    icon: POLICY_ICON[value],
    label: PLAN_LIMIT_POLICY_META[value].label,
    description: value === "api" && !view.hasKey ? "Needs an Anthropic key (API keys below)." : PLAN_LIMIT_POLICY_META[value].description,
    disabled: value === "api" && !view.hasKey,
  }));
  const spin = (op: string) => (busy === op ? <Spinner /> : null);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start gap-3">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <TerminalIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">{meta.switchLabel}</span>
          <span className="text-xs text-muted-foreground">
            {meta.label}
            {view.version ? ` ${view.version}` : ""} on this computer runs the agents on Claude models with your plan: no API spend, the
            agents keep their model, and each stage still has its turn limit. Off on your other computers until you switch it on there.
          </span>
        </span>
        <Switch
          checked={view.enabled}
          onCheckedChange={(next) => run(next ? "enable" : "disable")}
          disabled={pending || (!view.enabled && !canEnable)}
          aria-label={meta.switchLabel}
          className="mt-1"
        />
      </label>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
        {!view.installed ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 font-medium">
              <CircleAlertIcon className="size-4 text-warning" /> Claude Code isn&apos;t installed on this computer.
            </p>
            <p className="text-xs text-muted-foreground">Install it in a terminal, then choose Check again:</p>
            <code className="block overflow-x-auto rounded-md border bg-card px-3 py-2 font-mono text-xs">{view.installCommand}</code>
          </div>
        ) : view.problem ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-2 font-medium">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" /> {view.problem}
            </p>
            <code className="block overflow-x-auto rounded-md border bg-card px-3 py-2 font-mono text-xs">{view.installCommand}</code>
          </div>
        ) : signedIn && view.auth ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="eyebrow text-muted-foreground">Signed in for TechTeam</p>
            <p className="truncate font-medium">{view.auth.account}</p>
            {view.accountConfirmed ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <BadgeCheckIcon className="size-3.5 text-success" /> Confirmed as your account
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {view.confirmed ? `You confirmed ${view.confirmed.email}${view.confirmed.orgName ? ` (${view.confirmed.orgName})` : ""}: agents won't run on another account.` : "Make sure this is your personal account, not a work one, then confirm it."}
              </p>
            )}
            {!view.auth.isPlan && <p className="text-xs text-warning">This login has no Claude plan (an API key or a cloud provider).</p>}
            {view.auth.expiresAt && <p className="text-xs text-muted-foreground">Login expires {formatTime(view.auth.expiresAt)}.</p>}
          </div>
        ) : (
          <p className="text-muted-foreground">
            Not signed in. TechTeam keeps its own Claude Code login, separate from the one you use in your terminal: sign in with your
            personal account.
          </p>
        )}

        {view.installed && !view.problem && (
          <div className="flex flex-wrap items-center gap-2">
            {signedIn ? (
              <>
                {!view.accountConfirmed && view.auth?.isPlan && (
                  <Button size="sm" onClick={() => run("confirm")} disabled={pending}>
                    {spin("confirm")} Confirm this account
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => run("sign_out")} disabled={pending}>
                  {spin("sign_out")} Sign out
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => run("sign_in")} disabled={pending}>
                {spin("sign_in")} Sign in
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => run("check")} disabled={pending}>
              {busy === "check" ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />} Check again
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {view.agents.length
          ? `On Claude models in this workspace: ${view.agents.join(", ")}.`
          : "No agent in this workspace is on a Claude model: pick one on the AI Team page to use your plan."}
        {view.limitedUntil && ` Your plan is out of usage until ${formatTime(view.limitedUntil)}.`}
      </p>

      <OptionCards name="plan-limit" legend="When my plan runs out" options={policies} value={view.onLimit} onChange={choosePolicy} />

      <FormMessage message={error ?? undefined} />
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
