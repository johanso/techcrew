"use client";

import { startTransition, useActionState, useState } from "react";
import { CheckIcon, GitMergeIcon, GitPullRequestIcon, HandIcon, PlayIcon, ZapIcon } from "lucide-react";

import { saveAutomationAction, type AutomationFormState } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { OptionCards, type OptionCard } from "@/components/settings/option-cards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Mode = "manual" | "auto";

const PICKUP: OptionCard<Mode>[] = [
  { value: "manual", icon: PlayIcon, label: "Manual", description: "Cards start when you press Run on them." },
  { value: "auto", icon: ZapIcon, label: "Automatic", description: "The Analyst picks the top Todo card every few minutes, one at a time." },
];

const MERGE: OptionCard<Mode>[] = [
  { value: "manual", icon: HandIcon, label: "Manual", description: "Approved pull requests wait for you on the Pull Requests page." },
  { value: "auto", icon: GitMergeIcon, label: "Automatic", description: "Merged as soon as review, tests and CI pass." },
];

/** Settings → Agents: task pickup and merge modes. */
export function AgentAutomationForm({ workspaceId, autoPickup, autoMerge }: { workspaceId: number; autoPickup: boolean; autoMerge: boolean }) {
  const [state, formAction, pending] = useActionState<AutomationFormState, FormData>(saveAutomationAction.bind(null, workspaceId), {});
  const [pickup, setPickup] = useState<Mode>(autoPickup ? "auto" : "manual");
  const [merge, setMerge] = useState<Mode>(autoMerge ? "auto" : "manual");
  // Compared with what the server rendered, so "Saved" shows only until the next edit.
  const dirty = pickup !== (autoPickup ? "auto" : "manual") || merge !== (autoMerge ? "auto" : "manual");

  return (
    <form
      // Dispatched by hand: a form `action` resets the form afterwards, which would flip the radios back.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-6 border-t border-border/70 p-6"
    >
      <OptionCards name="pickup" legend="Task pickup" options={PICKUP} value={pickup} onChange={setPickup} />
      <OptionCards name="merge" legend="Merging pull requests" options={MERGE} value={merge} onChange={setMerge} />
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <GitPullRequestIcon className="mt-0.5 size-3.5 shrink-0" />
        If a merge hits a conflict or a failing build, the Tester files a follow-up card in Todo with the details.
      </p>
      <FormMessage message={state.message} />
      <div className="flex items-center justify-end gap-3">
        {state.ok && !dirty && !pending && (
          <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CheckIcon className="size-3.5 text-success" />
            Saved
          </span>
        )}
        <Button type="submit" className="h-10" disabled={pending || !dirty}>
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save automation"}
        </Button>
      </div>
    </form>
  );
}
