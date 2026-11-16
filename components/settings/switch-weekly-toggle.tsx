"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CalendarClockIcon } from "lucide-react";

import { saveSwitchWeeklyAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Switch } from "@/components/ui/switch";

/** Settings → Switch Trust: a SwitchAgent scan of every agent each week. */
export function SwitchWeeklyToggle({ workspaceId, enabled }: { workspaceId: number; enabled: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setOptimistic(next);
      setError(null);
      const result = await saveSwitchWeeklyAction(workspaceId, next);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-3">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <CalendarClockIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">Scan every week</span>
          <span className="text-xs text-muted-foreground">
            Every Monday, Switch evaluates each agent again, so the score follows changes to models and instructions. Each
            scan spends a little of the agent&apos;s budget answering Switch&apos;s tests.
          </span>
        </span>
        <Switch checked={optimistic} onCheckedChange={toggle} disabled={pending} aria-label="Scan every week" className="mt-1" />
      </label>
      <FormMessage message={error ?? undefined} />
    </div>
  );
}
