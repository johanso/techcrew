"use client";

import { startTransition, useActionState, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, LockIcon, RadarIcon, ServerIcon, TriangleAlertIcon } from "lucide-react";

import {
  connectSwitchAction,
  disconnectSwitchAction,
  type SwitchConnectionState,
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
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useFieldErrors } from "@/hooks/use-field-errors";
import type { SwitchConnectionView } from "@/lib/switch-trust";
import { DEFAULT_SWITCH_INSTANCE } from "@/lib/switch-trust-config";

const KEYS_URL = "https://docs.switchagents.ai/switch-trust/admin/api-keys";

function ConnectionStatus({ view }: { view: SwitchConnectionView }) {
  if (!view.connected) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />
        Not connected
      </p>
    );
  }
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {view.source === "workspace" ? (
        <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
      ) : (
        <ServerIcon aria-hidden className="size-3.5 shrink-0 text-action" />
      )}
      <span className="font-medium text-foreground">Connected</span>
      {view.source === "workspace" ? (
        <span className="truncate font-mono">{view.hint}</span>
      ) : (
        <span>
          with the server&apos;s key (<code className="font-mono">SWITCH_AGENT_AI_API_KEY</code>)
        </span>
      )}
      {view.updatedAt && (
        // Relative time differs by a second between server render and hydration; that's expected.
        <span suppressHydrationWarning>· saved {formatDistanceToNowStrict(new Date(view.updatedAt), { addSuffix: true })}</span>
      )}
    </p>
  );
}

/**
 * Settings → Switch Trust: the workspace's Switch account. Connecting checks the key with Switch, fills tenant and
 * workspace from it, and starts a SwitchAgent scan of every agent. The saved key never comes back to the page.
 */
export function SwitchConnectionForm({ workspaceId, view }: { workspaceId: number; view: SwitchConnectionView }) {
  const [state, formAction, pending] = useActionState<SwitchConnectionState, FormData>(connectSwitchAction.bind(null, workspaceId), {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const keyError = errorFor("apiKey");
  const keyOptional = view.connected || view.serverKeyAvailable;

  const disconnect = () => {
    setRemoving(true);
    startTransition(async () => {
      const result = await disconnectSwitchAction(workspaceId);
      setRemoving(false);
      setConfirming(false);
      setRemoveError(result.ok ? null : result.error);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-bold">Switch account</h3>
          <ConnectionStatus view={view} />
          {view.connected && view.evaluationName && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RadarIcon aria-hidden className="size-3.5 shrink-0" />
              Each agent runs one evaluation: <span className="font-medium text-foreground">{view.evaluationName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={KEYS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-emphasis hover:bg-accent"
          >
            Get a key
            <ExternalLinkIcon className="size-3.5" />
          </a>
          {view.connected && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {view.problem && (
        <p className="flex gap-2 rounded-lg bg-warning/8 p-3 text-xs ring-1 ring-warning/25">
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            <span className="font-semibold">Scans can&apos;t run from this server yet.</span> {view.problem}
          </span>
        </p>
      )}

      <form
        // Dispatched by hand: on an error the pasted key stays in the field to fix. A successful save remounts
        // the key input (key = savedAt), which clears it, so the secret doesn't linger in the page.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
        onChange={onChange}
        className="flex flex-col gap-4"
      >
        <Field data-invalid={!!keyError}>
          <FieldLabel htmlFor="switch-api-key">API key</FieldLabel>
          <InputGroup className="h-10">
            <InputGroupInput
              key={state.savedAt ?? 0}
              id="switch-api-key"
              name="apiKey"
              type={visible ? "text" : "password"}
              placeholder={view.source === "workspace" ? "Paste a new key to replace it" : keyOptional ? "Leave empty to use the server's key" : "sk_…"}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={!!keyError}
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Hide key" : "Show key"}
                aria-pressed={visible}
                aria-controls="switch-api-key"
              >
                {visible ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{keyError}</FieldError>
          <FieldDescription>A key with the Editor role: it registers your agents and runs evaluations.</FieldDescription>
        </Field>

        <Field data-invalid={!!errorFor("instanceUrl")}>
          <FieldLabel htmlFor="switch-instance">Instance URL</FieldLabel>
          <Input
            id="switch-instance"
            name="instanceUrl"
            className="h-10"
            defaultValue={view.instanceUrl?.replace(/\/api\/v1$/, "") ?? DEFAULT_SWITCH_INSTANCE}
            placeholder={DEFAULT_SWITCH_INSTANCE}
            aria-invalid={!!errorFor("instanceUrl")}
          />
          <FieldError>{errorFor("instanceUrl")}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errorFor("tenantId")}>
            <FieldLabel htmlFor="switch-tenant">Tenant ID</FieldLabel>
            <Input
              id="switch-tenant"
              name="tenantId"
              className="h-10 font-mono"
              defaultValue={view.tenantId ?? ""}
              placeholder="Detected from the key"
              aria-invalid={!!errorFor("tenantId")}
            />
            <FieldError>{errorFor("tenantId")}</FieldError>
          </Field>
          <Field data-invalid={!!errorFor("switchWorkspaceId")}>
            <FieldLabel htmlFor="switch-workspace">Workspace ID</FieldLabel>
            <Input
              id="switch-workspace"
              name="switchWorkspaceId"
              className="h-10 font-mono"
              defaultValue={view.switchWorkspaceId ?? ""}
              placeholder="Detected from the key"
              aria-invalid={!!errorFor("switchWorkspaceId")}
            />
            <FieldError>{errorFor("switchWorkspaceId")}</FieldError>
          </Field>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" className="h-10" disabled={pending}>
            {pending ? <Spinner /> : <LockIcon data-icon="inline-start" />}
            {pending ? "Connecting…" : view.connected ? "Update connection" : "Connect securely"}
          </Button>
          {state.ok && !pending && (
            <p role="status" className="text-xs text-muted-foreground">
              {state.scansQueued
                ? `Connected. SwitchAgent is scanning ${state.scansQueued} agent${state.scansQueued === 1 ? "" : "s"}; scores show on the AI Team page when ready.`
                : state.scanError
                  ? `Connected, but scans couldn't start: ${state.scanError}`
                  : "Connected."}
            </p>
          )}
        </div>
      </form>
      <FormMessage message={state.message ?? removeError ?? undefined} />

      <AlertDialog open={confirming} onOpenChange={(open) => !removing && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Switch Trust?</AlertDialogTitle>
            <AlertDialogDescription>
              The key is deleted from this workspace and scans in progress stop. Scores already saved stay on the agents.
              Nothing is deleted in your Switch account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={disconnect} disabled={removing}>
              {removing && <Spinner />}
              {removing ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
