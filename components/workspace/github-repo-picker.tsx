"use client";

import { Suspense, use, useDeferredValue, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckIcon, GlobeIcon, LockIcon, SearchIcon, UnplugIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { FormMessage } from "@/components/auth/form-parts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { GithubRepo } from "@/lib/github";
import { cn } from "@/lib/utils";

export type GithubAccount = { login: string; avatarUrl: string | null };
export type RepoListResult = { repos: GithubRepo[] } | { error: string; reconnect?: boolean };
export type GithubStatus = "connected" | "denied" | "error" | "not-configured";

const STATUS_MESSAGES: Partial<Record<GithubStatus, string>> = {
  denied: "GitHub authorization was cancelled. Connect again whenever you're ready.",
  error: "We couldn't connect to GitHub. Please try again.",
  "not-configured": "GitHub integration isn't configured on this server yet.",
};

export function GithubRepoPicker({
  configured,
  account,
  status,
  reposPromise,
  connectHref,
  selected,
  onSelect,
  onBeforeLeave,
  onDisconnect,
  error,
}: {
  configured: boolean;
  account: GithubAccount | null;
  status?: GithubStatus;
  reposPromise: Promise<RepoListResult> | null;
  connectHref: string;
  selected: string | null;
  onSelect: (fullName: string) => void;
  /** Called before navigating away to GitHub so the form can persist its draft. */
  onBeforeLeave: () => Promise<void>;
  onDisconnect: () => void;
  error?: string;
}) {
  const statusMessage = status && STATUS_MESSAGES[status];

  if (!account) {
    return (
      <div className="flex flex-col gap-3">
        {statusMessage && <FormMessage message={statusMessage} />}
        <div className="flex flex-col items-start gap-4 rounded-xl border bg-muted/60 p-5 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-darkest text-lightest">
            <GitHubIcon className="size-5" />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-semibold">Connect your GitHub account</p>
            <p className="text-sm text-muted-foreground">
              We&apos;ll list the repositories you can push to so agents can work on one.
            </p>
          </div>
          <ConnectButton href={connectHref} disabled={!configured} onBeforeLeave={onBeforeLeave} />
        </div>
        <FieldError>{error}</FieldError>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
        <Avatar size="sm">
          {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}
          <AvatarFallback>{account.login[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <p className="flex-1 truncate text-sm">
          Connected as <span className="font-semibold">@{account.login}</span>
        </p>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onDisconnect}>
          <UnplugIcon />
          Disconnect
        </Button>
      </div>

      {reposPromise && (
        <Suspense fallback={<RepoListSkeleton />}>
          <RepoList
            reposPromise={reposPromise}
            selected={selected}
            onSelect={onSelect}
            connectHref={connectHref}
            onBeforeLeave={onBeforeLeave}
          />
        </Suspense>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}

function ConnectButton({
  href,
  disabled,
  onBeforeLeave,
  label = "Connect GitHub",
}: {
  href: string;
  disabled?: boolean;
  onBeforeLeave: () => Promise<void>;
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  // Clear the spinner when the user comes back from GitHub via the Back button (bfcache).
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <a
      href={href}
      aria-disabled={disabled || pending}
      onClick={async (event) => {
        event.preventDefault();
        if (disabled || pending) return;
        setPending(true);
        await onBeforeLeave();
        window.location.assign(href);
      }}
      className={cn(
        buttonVariants(),
        "h-9 bg-darkest text-lightest hover:bg-darkest/85",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      {pending ? <Spinner /> : <GitHubIcon className="size-4" />}
      {label}
    </a>
  );
}

function RepoList({
  reposPromise,
  selected,
  onSelect,
  connectHref,
  onBeforeLeave,
}: {
  reposPromise: Promise<RepoListResult>;
  selected: string | null;
  onSelect: (fullName: string) => void;
  connectHref: string;
  onBeforeLeave: () => Promise<void>;
}) {
  const result = use(reposPromise);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  if ("error" in result) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormMessage message={result.error} />
        {result.reconnect && (
          <ConnectButton href={connectHref} onBeforeLeave={onBeforeLeave} label="Reconnect GitHub" />
        )}
      </div>
    );
  }

  if (result.repos.length === 0) {
    return (
      <p className="rounded-xl border bg-muted/60 p-6 text-center text-sm text-muted-foreground">
        This account has no repositories you can push to. Create one on GitHub, or connect a different account.
      </p>
    );
  }

  const visible = deferredQuery
    ? result.repos.filter((repo) => repo.fullName.toLowerCase().includes(deferredQuery))
    : result.repos;

  return (
    <div className="flex flex-col gap-2">
      <InputGroup className="h-10">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder={`Search ${result.repos.length} repositories`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search repositories"
        />
      </InputGroup>

      <div role="radiogroup" aria-label="Repository" className="max-h-80 overflow-y-auto rounded-xl border bg-card">
        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No repositories match “{query}”.</p>
        )}
        {visible.map((repo) => {
          const checked = selected === repo.fullName;
          return (
            <label
              key={repo.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0",
                "hover:bg-accent has-focus-visible:bg-accent",
                checked && "bg-brand/5 hover:bg-brand/10"
              )}
            >
              <input
                type="radio"
                name="repo"
                value={repo.fullName}
                checked={checked}
                onChange={() => onSelect(repo.fullName)}
                className="peer sr-only"
              />
              <span className="mt-0.5 text-muted-foreground">
                {repo.private ? <LockIcon className="size-4" /> : <GlobeIcon className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">
                  <span className="text-muted-foreground">{repo.owner}/</span>
                  <span className="font-semibold">{repo.name}</span>
                </span>
                {repo.description && (
                  <span className="line-clamp-1 text-xs text-muted-foreground">{repo.description}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {repo.private ? "Private" : "Public"} · {repo.defaultBranch}
                  {repo.pushedAt && ` · updated ${formatDistanceToNow(repo.pushedAt, { addSuffix: true })}`}
                </span>
              </span>
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                  checked && "border-brand bg-brand text-brand-foreground"
                )}
              >
                {checked && <CheckIcon className="size-3.5" />}
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Only repositories you can push to are listed. Missing an organization repo? Grant this app access in your
        GitHub organization settings.
      </p>
    </div>
  );
}

function RepoListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      <Skeleton className="h-10 rounded-lg" />
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
