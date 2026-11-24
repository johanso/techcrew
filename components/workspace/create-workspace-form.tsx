"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import { createWorkspace, disconnectGithub, type WorkspaceFormState } from "@/app/workspaces/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AppearancePicker, useObjectUrl } from "@/components/workspace/appearance-picker";
import {
  GithubRepoPicker,
  type GithubAccount,
  type RepoListResult,
} from "@/components/workspace/github-repo-picker";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { saveDraft, takeDraft } from "@/components/workspace/workspace-draft";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { DEFAULT_WORKSPACE_ICON, type WorkspaceIconKey } from "@/lib/workspace-icons";
import { cn } from "@/lib/utils";

const CONNECT_HREF = `/sign-in?next=${encodeURIComponent("/workspaces/new")}`;

export function CreateWorkspaceForm({
  github,
  reposPromise,
  cancelHref,
}: {
  github: GithubAccount | null;
  reposPromise: Promise<RepoListResult> | null;
  cancelHref?: string;
}) {
  const [state, dispatch, pending] = useActionState<WorkspaceFormState, FormData>(createWorkspace, {});
  const { errorFor, onChange } = useFieldErrors(state);
  const [disconnecting, startDisconnect] = useTransition();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<WorkspaceIconKey>(DEFAULT_WORKSPACE_ICON);
  const [logo, setLogo] = useState<File | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const logoUrl = useObjectUrl(logo);

  // Restore what the user typed before leaving for GitHub.
  useEffect(() => {
    takeDraft().then((draft) => {
      if (!draft) return;
      setName(draft.name);
      setIcon(draft.icon);
      setLogo(draft.logo);
      setRepo(draft.repo);
    });
  }, []);

  const persistDraft = () => saveDraft({ name, icon, logo, repo });

  const steps = { name: name.trim().length > 0, appearance: true, repo: Boolean(github && repo) };
  const canSubmit = steps.name && steps.repo && !pending;

  return (
    <form
      noValidate
      onChange={onChange}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        if (logo) formData.set("logo", logo);
        else formData.delete("logo");
        // Manual dispatch keeps controlled fields intact (form actions reset the form).
        startTransition(() => dispatch(formData));
      }}
      className="flex flex-col gap-6"
    >
      <div className="surface-brand flex items-center gap-4 p-5">
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 -z-10 size-44 rounded-full border border-white/15" />
        <WorkspaceAvatar icon={icon} logoSrc={logoUrl} size="lg" className="bg-white/15 ring-1 ring-white/25" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="eyebrow text-white/70">Preview</p>
          <p className={cn("truncate text-lg font-bold", !name.trim() && "text-white/60")}>
            {name.trim() || "Untitled workspace"}
          </p>
          <p className="truncate text-sm text-white/75">{repo ?? "No repository linked yet"}</p>
        </div>
      </div>

      <FormMessage message={state.message} />

      <Step number={1} done={steps.name} title="Name your workspace" description="Usually your team, product or project.">
        <Field data-invalid={!!errorFor("name")}>
          <FieldLabel htmlFor="workspace-name" className="sr-only">
            Workspace name
          </FieldLabel>
          <Input
            id="workspace-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Acme Platform"
            maxLength={60}
            autoComplete="off"
            aria-invalid={!!errorFor("name")}
            className="h-10"
            autoFocus
            required
          />
          <FieldError>{errorFor("name")}</FieldError>
        </Field>
      </Step>

      <Step
        number={2}
        done={steps.appearance}
        title="Pick an icon or upload a logo"
        description="Shown in the workspace switcher and across the dashboard."
      >
        <AppearancePicker
          icon={icon}
          onIconChange={setIcon}
          logo={logo}
          onLogoChange={setLogo}
          error={errorFor("logo") ?? errorFor("icon")}
        />
      </Step>

      <Step
        number={3}
        done={steps.repo}
        title="Link a GitHub repository"
        description="Each workspace works on exactly one repository. AI agents read and push to it."
        last
      >
        <GithubRepoPicker
          account={github}
          reposPromise={reposPromise}
          connectHref={CONNECT_HREF}
          selected={repo}
          onSelect={setRepo}
          onBeforeLeave={persistDraft}
          onDisconnect={() =>
            // Signing out leaves the page: the draft (name, icon, logo) is kept so it is there after signing in again.
            startDisconnect(async () => {
              await persistDraft();
              await disconnectGithub();
            })
          }
          error={errorFor("repo")}
        />
      </Step>

      <div className="flex flex-col-reverse items-stretch gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        {cancelHref ? (
          <Link href={cancelHref} className={buttonVariants({ variant: "ghost", className: "h-10" })}>
            Cancel
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">You can add more workspaces later.</p>
        )}
        <Button type="submit" disabled={!canSubmit || disconnecting} className="h-10 px-5">
          {pending ? <Spinner /> : null}
          {pending ? "Creating workspace…" : "Next"}
          {!pending && <ArrowRightIcon data-icon="inline-end" />}
        </Button>
      </div>
    </form>
  );
}

function Step({
  number,
  title,
  description,
  done,
  last,
  children,
}: {
  number: number;
  title: string;
  description: string;
  done: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
            done ? "border-brand bg-brand text-brand-foreground" : "bg-card text-muted-foreground"
          )}
        >
          {done ? <CheckIcon className="size-4" /> : number}
        </span>
        {!last && <span aria-hidden className="mt-2 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("flex flex-col gap-4", !last && "pb-2")}>
        <div className="flex flex-col gap-0.5 pt-1">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}
