"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ArrowLeftRightIcon } from "lucide-react";

import { saveAutoFailoverAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Switch } from "@/components/ui/switch";

/** Settings → AI providers: move agents to another company on their own when theirs runs out of credit mid-run. */
export function AutoFailoverToggle({ workspaceId, enabled, canSwitch }: { workspaceId: number; enabled: boolean; canSwitch: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setOptimistic(next);
      setError(null);
      const result = await saveAutoFailoverAction(workspaceId, next);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-3">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <ArrowLeftRightIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">Switch automatically when out of credit</span>
          <span className="text-xs text-muted-foreground">
            If a company runs out of credit while agents work, the agents on it move to the next company with a key
            in the order below (closest model) and the stage starts over there, instead of stopping.
            You get a notification either way.
            {!canSwitch && " Needs API keys for at least two companies."}
          </span>
        </span>
        <Switch checked={optimistic} onCheckedChange={toggle} disabled={pending} aria-label="Switch automatically when out of credit" className="mt-1" />
      </label>
      <FormMessage message={error ?? undefined} />
    </div>
  );
}
