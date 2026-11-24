"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon } from "lucide-react";

import { saveFallbackOrderAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { PROVIDERS, type AgentProvider } from "@/lib/agent-config";

/**
 * Settings → AI → This workspace only: the order companies are tried in when one runs out (of credit, or of your
 * Claude plan with "Switch company"). `order` is the full effective order, so what shows is what a run will do.
 */
export function FallbackOrder({
  workspaceId,
  order,
  hasKey,
}: {
  workspaceId: number;
  order: AgentProvider[];
  hasKey: Record<AgentProvider, boolean>;
}) {
  const [optimistic, setOptimistic] = useOptimistic(order);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const move = (index: number, by: -1 | 1) => {
    const next = [...optimistic];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    startTransition(async () => {
      setOptimistic(next);
      setError(null);
      const result = await saveFallbackOrderAction(workspaceId, next);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <ListOrderedIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-sm font-semibold">If a company runs out, try them in this order</h3>
          <p className="text-xs text-muted-foreground">
            Used when a company runs out of credit and when your Claude plan runs out with &quot;Switch company&quot;. The first
            company in the list with a key that isn&apos;t the one that ran out is taken.
          </p>
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {optimistic.map((provider, index) => (
          <li key={provider} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
            <span className="w-4 text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{PROVIDERS[provider].label}</span>
            <span className="text-xs text-muted-foreground">{hasKey[provider] ? "Has a key" : "No key"}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending || index === 0}
              onClick={() => move(index, -1)}
              aria-label={`Move ${PROVIDERS[provider].label} up`}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending || index === optimistic.length - 1}
              onClick={() => move(index, 1)}
              aria-label={`Move ${PROVIDERS[provider].label} down`}
            >
              <ArrowDownIcon />
            </Button>
          </li>
        ))}
      </ol>
      <FormMessage message={error ?? undefined} />
    </div>
  );
}
