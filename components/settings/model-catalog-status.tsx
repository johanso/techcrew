"use client";

import { useState, useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";

import { refreshModelsAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Settings → AI: where the model list comes from and when it was last updated, with Refresh models (OpenRouter's
 * public list: no key, no spend). The page computes `updated` so server and browser render the same text.
 */
export function ModelCatalogStatus({
  workspaceId,
  updated,
  current,
}: {
  workspaceId: number;
  /** "3 hours ago", or null while the app runs on the built-in list. */
  updated: string | null;
  /** How many models the pickers offer now. */
  current: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    startTransition(async () => {
      setError(null);
      // On success the page re-renders with the new date and count.
      const result = await refreshModelsAction(workspaceId);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-bold">Models</h3>
          <p className="text-xs text-muted-foreground">
            {updated ? (
              <>
                Models updated {updated} · <span className="tabular-nums">{current}</span> current models from OpenRouter&apos;s public list. Each
                agent picks one on the AI Team page.
              </>
            ) : (
              <>Built-in list for now: the current models haven&apos;t been fetched yet.</>
            )}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={refresh} disabled={pending}>
          {pending ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          {pending ? "Refreshing models…" : "Refresh models"}
        </Button>
      </div>
      <FormMessage message={error ?? undefined} />
    </div>
  );
}
