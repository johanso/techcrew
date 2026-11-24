"use client";

import { startTransition, use, useActionState, useState, useTransition } from "react";
import { AppWindowIcon, CheckIcon, CircleCheckIcon, CircleXIcon, PlayIcon, ServerOffIcon, ShieldAlertIcon, TerminalIcon } from "lucide-react";

import {
  checkSandboxAction,
  saveSandboxAction,
  type SandboxCheckResult,
  type SandboxFormState,
} from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { cn } from "@/lib/utils";
import {
  PREVIEW_MAX_AGE_MS,
  PREVIEW_PORT,
  SANDBOX_COMMAND_KINDS,
  SANDBOX_COMMAND_LABEL,
  type SandboxCommandKind,
  type SandboxCommands,
  type StoredSandboxCommands,
} from "@/lib/sandbox/config";
import type { SandboxMode } from "@/lib/sandbox/mode";

type Values = Record<SandboxCommandKind, string>;

/** The form's values: what's saved, else what package.json suggests (also for `preview` on rows saved before it). */
const toValues = (saved: StoredSandboxCommands | null, detected: SandboxCommands | null = null): Values => {
  const values = {} as Values;
  for (const kind of SANDBOX_COMMAND_KINDS) {
    values[kind] = (saved && kind in saved ? saved[kind] : detected?.[kind]) ?? "";
  }
  return values;
};

// The commands agents run; `preview` sits under the Previews switch.
const AGENT_COMMAND_KINDS = SANDBOX_COMMAND_KINDS.filter((kind) => kind !== "preview");

type SandboxFormProps = {
  workspaceId: number;
  enabled: boolean;
  saved: StoredSandboxCommands | null;
  /** `local`: this computer's own Docker; `remote`: a sandbox host prepared with deploy/setup.sh. */
  mode: SandboxMode;
  /** This computer can serve previews (local: always; remote: SANDBOX_PREVIEW_DOMAIN is set). */
  previewsAvailable: boolean;
  previewEnabled: boolean;
  /** Local only: installs may run packages' install scripts. */
  allowScripts: boolean;
};

/** Settings → Sandbox, once the commands detected from package.json have loaded (null: package.json couldn't be read). */
export function SandboxSettings({ detected, ...props }: SandboxFormProps & { detected: Promise<SandboxCommands | null> }) {
  return <SandboxForm {...props} detected={use(detected)} />;
}

/** Matches SandboxForm while the detected commands load. */
export function SandboxFormSkeleton() {
  return (
    <div className="flex flex-col gap-6 border-t border-border/70 p-6" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </div>
      {SANDBOX_COMMAND_KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
    </div>
  );
}

function SandboxForm({
  workspaceId,
  enabled,
  saved,
  detected,
  mode,
  previewsAvailable,
  previewEnabled,
  allowScripts,
}: SandboxFormProps & { detected: SandboxCommands | null }) {
  const [state, formAction, pending] = useActionState<SandboxFormState, FormData>(saveSandboxAction.bind(null, workspaceId), {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [on, setOn] = useState(enabled);
  const [previewOn, setPreviewOn] = useState(previewEnabled);
  const [scriptsOn, setScriptsOn] = useState(allowScripts);
  const [values, setValues] = useState<Values>(() => toValues(saved, detected));
  const [checking, startCheck] = useTransition();
  const [check, setCheck] = useState<SandboxCheckResult | null>(null);
  // Previews run in the sandbox: switching it off (or a computer without previews) switches them off too.
  const previews = on && previewOn && previewsAvailable;

  // Compared with what the server rendered, so "Saved" shows only until the next edit. Nothing saved yet: always savable.
  const savedValues = toValues(saved);
  const dirty =
    !saved || on !== enabled || previews !== previewEnabled || (mode === "local" && scriptsOn !== allowScripts) || SANDBOX_COMMAND_KINDS.some((kind) => values[kind].trim() !== savedValues[kind]);

  const commandField = (kind: SandboxCommandKind, hint?: React.ReactNode) => {
    const error = errorFor(kind);
    const found = detected?.[kind];
    return (
      <Field key={kind} data-invalid={!!error}>
        <FieldLabel htmlFor={`sandbox-${kind}`}>{SANDBOX_COMMAND_LABEL[kind]}</FieldLabel>
        <Input
          id={`sandbox-${kind}`}
          name={kind}
          className="h-10 font-mono text-sm"
          value={values[kind]}
          onChange={(event) => setValues((current) => ({ ...current, [kind]: event.target.value }))}
          placeholder={found ?? "Nothing to run"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
        />
        <FieldError>{error}</FieldError>
        <FieldDescription>
          {detected === null ? (
            "Couldn't read package.json on the default branch."
          ) : found ? (
            <>
              Detected from package.json: <code className="font-mono">{found}</code>
            </>
          ) : (
            "Nothing detected. Leave it empty to skip this step."
          )}
          {hint}
        </FieldDescription>
      </Field>
    );
  };

  const runCheck = () =>
    startCheck(async () => {
      setCheck(null);
      setCheck(await checkSandboxAction(workspaceId));
    });

  return (
    <form
      // Dispatched by hand: a form `action` resets the form afterwards, which would put the inputs back.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("enabled", on ? "on" : "off");
        data.set("preview_enabled", previews ? "on" : "off");
        if (mode === "local") data.set("allow_scripts", scriptsOn ? "on" : "off");
        startTransition(() => formAction(data));
      }}
      onChange={onChange}
      className="flex min-w-0 flex-col gap-6 border-t border-border/70 p-6"
    >
      <label className="flex cursor-pointer items-start gap-3">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <TerminalIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">Let agents run code in the sandbox</span>
          <span className="text-xs text-muted-foreground">
            The Developer and the Tester install, test and build each change on a throwaway copy of the branch. Your
            tests run without network access, and no token or secret ever enters the container.
          </span>
        </span>
        <Switch checked={on} onCheckedChange={setOn} disabled={pending} aria-label="Let agents run code in the sandbox" className="mt-1" />
      </label>

      <div className="flex flex-col gap-4">{AGENT_COMMAND_KINDS.map((kind) => commandField(kind))}</div>

      {mode === "local" && (
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
            scriptsOn && "border-warning/40"
          )}
        >
          <input type="checkbox" className="peer sr-only" checked={scriptsOn} onChange={(event) => setScriptsOn(event.target.checked)} disabled={pending} />
          <span
            aria-hidden
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-input bg-card transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground [&_svg]:hidden peer-checked:[&_svg]:block"
          >
            <CheckIcon className="size-3" strokeWidth={3} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldAlertIcon className="size-4 shrink-0 text-warning" />
              Allow install scripts (some packages need them)
            </span>
            <span className="text-xs text-muted-foreground">
              Off by default: this computer&apos;s Docker can&apos;t keep a package&apos;s install script away from your home network, so installs run
              with <code className="font-mono">--ignore-scripts</code>. Turn it on only for repositories you trust.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-col gap-4 border-t border-border/70 pt-6">
        <label className="flex cursor-pointer items-start gap-3">
          <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
            <AppWindowIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">Previews of pull requests</span>
            <span className="text-xs text-muted-foreground">
              {mode === "local" ? (
                <>
                  Once CI passes, each agent pull request is served on this computer at{" "}
                  <code className="font-mono">http://127.0.0.1:&lt;port&gt;</code>, where only you can open it, so the Tester and you can try the change.
                  The preview has no network access and stops when the pull request is merged or closed, or after{" "}
                  {PREVIEW_MAX_AGE_MS / 60_000} minutes.
                </>
              ) : (
                "Once CI passes, each agent pull request gets a live preview at a private https address for two hours, so the Tester and you can try the change. The preview has no network access and stops when the pull request is merged or closed."
              )}
            </span>
          </span>
          <Switch
            checked={previews}
            onCheckedChange={setPreviewOn}
            disabled={!previewsAvailable || !on || pending}
            aria-label="Previews of pull requests"
            className="mt-1"
          />
        </label>
        {!previewsAvailable ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ServerOffIcon className="mt-0.5 size-3.5 shrink-0" />
            No preview domain (SANDBOX_PREVIEW_DOMAIN) is set up on this computer, so previews can&apos;t be switched on.
          </p>
        ) : (
          !on && <p className="text-xs text-muted-foreground">Previews run in the sandbox: switch it on first.</p>
        )}
        {commandField(
          "preview",
          <>
            {" "}
            It gets <code className="font-mono">PORT={PREVIEW_PORT}</code> and <code className="font-mono">HOST=0.0.0.0</code> and must
            serve there.
          </>
        )}
      </div>

      <FormMessage message={state.message} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" className="h-9" onClick={runCheck} disabled={!saved || dirty || checking || pending}>
          {checking ? <Spinner /> : <PlayIcon data-icon="inline-start" />}
          {checking ? "Running… this can take a few minutes" : "Test the sandbox"}
        </Button>
        <div className="flex items-center justify-end gap-3">
          {state.ok && !dirty && !pending && (
            <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CheckIcon className="size-3.5 text-success" />
              Saved
            </span>
          )}
          <Button type="submit" className="h-10" disabled={pending || !dirty}>
            {pending && <Spinner />}
            {pending ? "Saving…" : "Save sandbox"}
          </Button>
        </div>
      </div>

      {check && <CheckResult result={check} />}
    </form>
  );
}

function CheckResult({ result }: { result: SandboxCheckResult }) {
  if (!result.ok) return <FormMessage message={result.error} />;
  return (
    <div role="status" className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <p className="flex items-start gap-2 text-sm font-medium">
        {result.passed ? (
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleXIcon className="mt-0.5 size-4 shrink-0 text-error" />
        )}
        <span className="min-w-0 break-words">{result.headline}</span>
      </p>
      {result.output && (
        <pre className="relative max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">{result.output}</pre>
      )}
    </div>
  );
}
