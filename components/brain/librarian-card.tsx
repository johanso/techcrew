"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleAlertIcon, CircleCheckIcon, FolderSearchIcon, InfoIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";

import { runLibrarianAction } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatMicros } from "@/lib/agent-config";
import { AUTO_MIN_SIGNALS, librarianBusy, type LibrarianJob, type LibrarianState } from "@/lib/memory-proposals";

// While a run is queued or going, the page is read again this often.
const REFRESH_MS = 4_000;

const BUSY: Record<LibrarianJob, { queued: string; running: string }> = {
  learn: { queued: "Waiting to learn from your signals…", running: "Learning from your signals…" },
  bootstrap: { queued: "Waiting to read the repository…", running: "Reading the repository…" },
};

export type LibrarianCardProps = {
  workspaceId: number;
  /** The run asked for or going, or how the last one ended. */
  state: LibrarianState | null;
  /** Why it can't run now, or where it runs. */
  access: { ok: true; runsOn: string } | { ok: false; reason: string };
  unconsumed: number;
  autoLearn: boolean;
  /** ISO date of the last bootstrap, or null when the memory was never built from the repository. */
  bootstrappedAt: string | null;
};

/** Brain → Librarian: "Learn now", the first memory from the repository, and what the last run did. */
export function LibrarianCard({ workspaceId, state, access, unconsumed, autoLearn, bootstrappedAt }: LibrarianCardProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | undefined>();
  const [asked, setAsked] = useState<LibrarianJob | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = librarianBusy(state);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [busy, router]);

  const run = (job: LibrarianJob) =>
    startTransition(async () => {
      setAsked(job);
      setMessage(undefined);
      const result = await runLibrarianAction(workspaceId, job).catch(() => ({ ok: false, message: "Something went wrong. Please try again." }));
      if (!result.ok) setMessage(result.message);
    });

  const disabled = pending || busy || !access.ok;
  const starting = (job: LibrarianJob) => pending && asked === job;

  return (
    <section className="surface flex min-w-0 flex-col" aria-label="Librarian">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <SparklesIcon />
          </span>
        }
        title="Librarian"
        description="Turns what was collected into proposals you review."
        actions={
          <Button type="button" variant="outline" className="h-9" disabled={disabled || !unconsumed} onClick={() => run("learn")}>
            {starting("learn") ? <Spinner /> : <WandSparklesIcon data-icon="inline-start" />}
            {starting("learn") ? "Starting…" : "Learn now"}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">
            {unconsumed} new signal{unconsumed === 1 ? "" : "s"}.
          </span>{" "}
          {autoLearn
            ? `It runs on its own a few minutes after ${AUTO_MIN_SIGNALS} new signals, or one you typed.`
            : "Automatic learning is off: it runs only when you ask."}{" "}
          It has no tools, writes nothing on its own, and is paid from the Lead&apos;s budget.{access.ok ? ` ${access.runsOn}` : ""}
        </p>

        {!access.ok && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-border/70 bg-muted/60 p-3 sm:flex-row sm:items-center">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
              <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {access.reason}
            </p>
            {access.reason.includes("API key") && (
              <Link href={`/dashboard/${workspaceId}/settings#ai`} className={buttonVariants({ variant: "outline", className: "h-9" })}>
                Add a key
              </Link>
            )}
          </div>
        )}

        <div aria-live="polite" className="empty:hidden">
          {busy && state ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Spinner className="text-brand-emphasis" />
              {BUSY[state.job][state.state === "running" ? "running" : "queued"]}
            </p>
          ) : state ? (
            <div className="flex min-w-0 items-start gap-2 text-sm">
              {state.state === "failed" ? (
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
              ) : (
                <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="wrap-anywhere">
                  <span className="font-semibold">{state.state === "failed" ? "The last run failed." : "Last run."}</span> {state.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={state.at} suppressHydrationWarning>
                    {formatDistanceToNowStrict(new Date(state.at), { addSuffix: true })}
                  </time>
                  {state.costMicros > 0 && <span className="tabular-nums"> · {formatMicros(state.costMicros)}</span>}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <FormMessage message={message} />

        <div className="flex flex-col items-start gap-3 rounded-lg border border-border/70 p-4 sm:flex-row sm:items-center">
          <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
            <FolderSearchIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="text-sm font-bold">{bootstrappedAt ? "Read the repository again" : "Build a first memory from this repository"}</h3>
            <p className="text-xs text-muted-foreground">
              {bootstrappedAt && (
                <>
                  Last read{" "}
                  <time dateTime={bootstrappedAt} suppressHydrationWarning>
                    {formatDistanceToNowStrict(new Date(bootstrappedAt), { addSuffix: true })}
                  </time>
                  .{" "}
                </>
              )}
              Reads the README, contributing and agent notes, package scripts, TypeScript, lint and formatter settings, CI workflows and the file
              layout from the default branch, and proposes a conventions note and a few more. You review them before anything is saved.
            </p>
          </div>
          <Button type="button" variant={bootstrappedAt ? "outline" : "default"} className="h-9 shrink-0" disabled={disabled} onClick={() => run("bootstrap")}>
            {starting("bootstrap") && <Spinner />}
            {starting("bootstrap") ? "Starting…" : bootstrappedAt ? "Read again" : "Build first memory"}
          </Button>
        </div>
      </div>
    </section>
  );
}
