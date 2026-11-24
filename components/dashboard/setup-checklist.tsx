import Link from "next/link";
import { ArrowRightIcon, CircleCheckIcon, CircleIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { setupPending, type SetupStep } from "@/lib/setup-status";
import { cn } from "@/lib/utils";

const COPY = {
  // The Overview, after the workspace exists.
  started: { eyebrow: "Get started", title: "Finish setting up TechTeam", intro: "A few things are left before agents can work on your repository." },
  // Before the first workspace: there is no Settings page yet.
  before: { eyebrow: "Before you start", title: "What you need", intro: "Agents need a way to reach an AI model and a repository to work on." },
} as const;

/** The setup steps as a list; renders nothing once every step is done. Presentational: the page loads the steps. */
export function SetupChecklist({ steps, variant, className }: { steps: SetupStep[]; variant: keyof typeof COPY; className?: string }) {
  if (!setupPending(steps)) return null;
  const copy = COPY[variant];
  const done = steps.filter((step) => step.done).length;

  return (
    <section aria-labelledby="setup-title" className={cn("surface flex min-w-0 flex-col", className)}>
      <div className="flex min-w-0 flex-col gap-1.5 border-b border-border/70 p-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-brand-emphasis">{copy.eyebrow}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {done} of {steps.length} done
          </p>
        </div>
        <h2 id="setup-title" className="text-base font-bold">
          {copy.title}
        </h2>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </div>
      <ol className="flex flex-col">
        {steps.map((step) => (
          <li key={step.id} className="flex min-w-0 items-start gap-3 border-b border-border/70 p-5 last:border-b-0 sm:px-6">
            {step.done ? (
              <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className={cn("text-sm font-semibold", step.done && "text-muted-foreground")}>
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
            {step.done ? (
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Done</span>
            ) : (
              step.href && (
                <Link href={step.href} className={buttonVariants({ variant: "outline", className: "h-9 shrink-0" })}>
                  Set up
                  <ArrowRightIcon aria-hidden />
                </Link>
              )
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
