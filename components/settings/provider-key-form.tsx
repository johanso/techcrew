"use client";

import { startTransition, useActionState, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, ServerIcon } from "lucide-react";

import {
  removeProviderKeyAction,
  saveProviderKeyAction,
  type ProviderKeyState,
} from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { PROVIDERS, type AgentProvider } from "@/lib/agent-config";
import type { ProviderKeyView } from "@/lib/ai-keys";

const CONSOLE_URL: Record<AgentProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/",
};
const PLACEHOLDER: Record<AgentProvider, string> = { openai: "sk-proj-…", anthropic: "sk-ant-…" };

function KeyStatus({ provider, view }: { provider: AgentProvider; view: ProviderKeyView }) {
  if (view.source === "workspace") {
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
        <span className="font-medium text-foreground">Connected</span>
        <span className="truncate font-mono">{view.hint}</span>
        {view.updatedAt && (
          // Relative time differs by a second between server render and hydration; that's expected.
          <span suppressHydrationWarning>· saved {formatDistanceToNowStrict(new Date(view.updatedAt), { addSuffix: true })}</span>
        )}
      </p>
    );
  }
  if (view.source === "environment") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ServerIcon aria-hidden className="size-3.5 shrink-0 text-action" />
        <span>
          Using the server&apos;s key (<code className="font-mono">{PROVIDERS[provider].envVar}</code>). Save one here to use your own.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />
      Not connected
    </p>
  );
}

/**
 * One provider's API key. The saved key never comes back from the server; the field only shows what you type
 * (the eye toggles that), and the saved key is shown masked.
 */
export function ProviderKeyForm({ workspaceId, provider, view }: { workspaceId: number; provider: AgentProvider; view: ProviderKeyView }) {
  const [state, formAction, pending] = useActionState<ProviderKeyState, FormData>(saveProviderKeyAction.bind(null, workspaceId, provider), {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const label = PROVIDERS[provider].label;
  const error = errorFor("apiKey");
  const inputId = `api-key-${provider}`;

  const remove = () => {
    setRemoving(true);
    startTransition(async () => {
      const result = await removeProviderKeyAction(workspaceId, provider);
      setRemoving(false);
      setConfirming(false);
      setRemoveError(result.ok ? null : result.error);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-bold">{label}</h3>
          <KeyStatus provider={provider} view={view} />
        </div>
        <div className="flex items-center gap-1">
          <a
            href={CONSOLE_URL[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-emphasis hover:bg-accent"
          >
            Get a key
            <ExternalLinkIcon className="size-3.5" />
          </a>
          {view.source === "workspace" && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <form
        // Dispatched by hand: on an error the pasted key stays in the field to fix. A successful save remounts
        // the input (key = savedAt), which clears it, so the secret doesn't linger in the page.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
        onChange={onChange}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <Field data-invalid={!!error} className="flex-1">
          <FieldLabel htmlFor={inputId} className="sr-only">
            {label} API key
          </FieldLabel>
          <InputGroup className="h-10">
            <InputGroupInput
              key={state.savedAt ?? 0}
              id={inputId}
              name="apiKey"
              type={visible ? "text" : "password"}
              placeholder={view.source === "workspace" ? "Paste a new key to replace it" : PLACEHOLDER[provider]}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={!!error}
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Hide key" : "Show key"}
                aria-pressed={visible}
                aria-controls={inputId}
              >
                {visible ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{error}</FieldError>
          {state.ok && !pending && (
            <FieldDescription>
              Key checked with {label} and saved.
              {state.scansQueued ? ` SwitchAgent is scanning ${state.scansQueued} agent${state.scansQueued === 1 ? "" : "s"} again.` : ""}
            </FieldDescription>
          )}
        </Field>
        <Button type="submit" variant="outline" className="h-10" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Checking key…" : view.source === "workspace" ? "Replace key" : "Save key"}
        </Button>
      </form>
      <FormMessage message={state.message ?? removeError ?? undefined} />

      <AlertDialog open={confirming} onOpenChange={(open) => !removing && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {label} key?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents on {label} models stop working until you add a key again, unless the server has{" "}
              {PROVIDERS[provider].envVar} set. The key is deleted from this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Spinner />}
              {removing ? "Removing…" : "Remove key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
