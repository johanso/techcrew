"use client";

import { startTransition, useActionState, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, ServerIcon, UserRoundIcon } from "lucide-react";

import {
  removeProviderKeyAction,
  saveProviderKeyAction,
  type KeyScopeName,
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
import type { ProviderKeyView, SavedKeyView } from "@/lib/ai-keys";

const CONSOLE_URL: Record<AgentProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/",
};
const PLACEHOLDER: Record<AgentProvider, string> = { openai: "sk-proj-…", anthropic: "sk-ant-…" };

function StatusLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

function SavedKey({ saved, label }: { saved: SavedKeyView; label: string }) {
  return (
    <>
      <span className="font-medium text-foreground">{label}</span>
      <span className="truncate font-mono">{saved.hint}</span>
      {/* Relative time differs by a second between server render and hydration; that's expected. */}
      <span suppressHydrationWarning>· saved {formatDistanceToNowStrict(new Date(saved.updatedAt), { addSuffix: true })}</span>
    </>
  );
}

const CHECK = <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />;

function KeyStatus({ provider, scope, view }: { provider: AgentProvider; scope: KeyScopeName; view: ProviderKeyView }) {
  const saved = scope === "account" ? view.account : view.workspace;
  if (scope === "account" && saved) {
    return <StatusLine icon={CHECK}><SavedKey saved={saved} label="Connected" /><span>· every project</span></StatusLine>;
  }
  if (scope === "workspace" && view.account) {
    // The account key wins: a project key saved too is kept but unused.
    return (
      <StatusLine icon={<UserRoundIcon aria-hidden className="size-3.5 shrink-0 text-action" />}>
        <span>
          Using your account&apos;s key <span className="font-mono">{view.account.hint}</span>.
          {saved ? ` This project's key (${saved.hint}) is only used if you remove it.` : ""}
        </span>
      </StatusLine>
    );
  }
  if (saved) {
    return <StatusLine icon={CHECK}><SavedKey saved={saved} label="Connected" /><span>· this project only</span></StatusLine>;
  }
  if (scope === "account" && view.workspace && view.inUse === "workspace") {
    return (
      <StatusLine icon={<CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />}>
        Not saved on your account. This project uses its own key.
      </StatusLine>
    );
  }
  if (view.environment) {
    return (
      <StatusLine icon={<ServerIcon aria-hidden className="size-3.5 shrink-0 text-action" />}>
        <span>
          Using the server&apos;s key (<code className="font-mono">{PROVIDERS[provider].envVar}</code>).
          {scope === "account" ? " Save one here to use your own in every project." : ""}
        </span>
      </StatusLine>
    );
  }
  return <StatusLine icon={<CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />}>Not connected</StatusLine>;
}

/**
 * One provider's API key, on the account (every project) or on this project only. The saved key never comes back
 * from the server; the field only shows what you type (the eye toggles that), and the saved key is shown masked.
 */
export function ProviderKeyForm({
  workspaceId,
  provider,
  scope,
  view,
}: {
  workspaceId: number;
  provider: AgentProvider;
  scope: KeyScopeName;
  view: ProviderKeyView;
}) {
  const [state, formAction, pending] = useActionState<ProviderKeyState, FormData>(saveProviderKeyAction.bind(null, workspaceId, provider, scope), {});
  const saved = scope === "account" ? view.account : view.workspace;
  const { errorFor, onChange } = useFieldErrors(state);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const label = PROVIDERS[provider].label;
  const error = errorFor("apiKey");
  const inputId = `api-key-${scope}-${provider}`;

  const remove = () => {
    setRemoving(true);
    startTransition(async () => {
      const result = await removeProviderKeyAction(workspaceId, provider, scope);
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
          <KeyStatus provider={provider} scope={scope} view={view} />
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
          {saved && (
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
              placeholder={saved ? "Paste a new key to replace it" : PLACEHOLDER[provider]}
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
          {pending ? "Checking key…" : saved ? "Replace key" : "Save key"}
        </Button>
      </form>
      <FormMessage message={state.message ?? removeError ?? undefined} />

      <AlertDialog open={confirming} onOpenChange={(open) => !removing && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {label} key?</AlertDialogTitle>
            <AlertDialogDescription>
              {scope === "account"
                ? `Every project without its own ${label} key stops running ${label} models until you add a key again, unless the server has ${PROVIDERS[provider].envVar} set. The key is deleted from your account.`
                : `This project falls back to your account's key, or the server's. The key is deleted from this project.`}
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
