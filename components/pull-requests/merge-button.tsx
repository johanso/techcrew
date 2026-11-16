"use client";

import { useState, useTransition } from "react";
import { GitMergeIcon } from "lucide-react";

import { mergePullRequestAction } from "@/app/dashboard/[workspaceId]/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Merge for a pull request that passed review and tests. Errors show inline; the page revalidates on success. */
export function MergeButton({ workspaceId, pullRequestId }: { workspaceId: number; pullRequestId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        className="h-9"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await mergePullRequestAction(workspaceId, pullRequestId);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? <Spinner /> : <GitMergeIcon data-icon="inline-start" />}
        {pending ? "Merging…" : "Merge"}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
