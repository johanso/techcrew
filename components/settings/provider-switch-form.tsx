"use client";

import { startTransition, useActionState, useState } from "react";
import { ArrowLeftRightIcon, BrainCircuitIcon, CheckIcon, SparklesIcon } from "lucide-react";

import { switchProviderAction, type ProviderSwitchState } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { OptionCards, type OptionCard } from "@/components/settings/option-cards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PROVIDERS, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";

const DESCRIPTION: Record<AgentProvider, string> = {
  openai: "GPT models: Astra, Sol, Terra and Luna.",
  anthropic: "Claude 5.5 models: Opus, Sonnet and Haiku.",
};
const ICON = { openai: BrainCircuitIcon, anthropic: SparklesIcon };

/** Settings → AI providers: which provider the whole team works on. */
export function ProviderSwitchForm({ workspaceId, provider, connected }: { workspaceId: number; provider: AgentProvider; connected: ProviderStatus }) {
  const [state, formAction, pending] = useActionState<ProviderSwitchState, FormData>(switchProviderAction.bind(null, workspaceId), {});
  const [value, setValue] = useState<AgentProvider>(provider);
  const dirty = value !== provider;

  const options: OptionCard<AgentProvider>[] = (Object.keys(PROVIDERS) as AgentProvider[]).map((id) => ({
    value: id,
    icon: ICON[id],
    label: PROVIDERS[id].label,
    description: connected[id] ? DESCRIPTION[id] : `Add an ${PROVIDERS[id].label} API key below to use it.`,
    // The current provider stays selectable even if its key was removed, so the form never shows nothing checked.
    disabled: !connected[id] && id !== provider,
  }));

  return (
    <form
      // Dispatched by hand: a form `action` resets the form afterwards, which would flip the radio back.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
    >
      <OptionCards name="provider" legend="Agents work on" options={options} value={value} onChange={setValue} />
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ArrowLeftRightIcon className="mt-0.5 size-3.5 shrink-0" />
        Each agent picks its own model from this company on the AI Team page, and remembers one per company: switching back
        restores what you chose. The first time, each agent gets the closest match (GPT-6.1 Sol ↔ Claude Sonnet 5.5, GPT-6
        Astra ↔ Claude Opus 5.5, GPT-6 Luna ↔ Claude Haiku 5.5). AI drafting and trust reviews follow the company too. Running
        cards switch at their next stage.
      </p>
      <FormMessage message={state.message} />
      <div className="flex items-center justify-end gap-3">
        {state.ok && !dirty && !pending && (
          <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CheckIcon className="size-3.5 text-success" />
            {state.switched ? `Switched ${state.switched} agent${state.switched === 1 ? "" : "s"}` : "Saved"}
          </span>
        )}
        <Button type="submit" className="h-10" disabled={pending || !dirty}>
          {pending && <Spinner />}
          {pending ? "Switching…" : "Switch provider"}
        </Button>
      </div>
    </form>
  );
}
