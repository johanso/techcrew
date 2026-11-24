"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon } from "lucide-react";

import { cancelGithubSignIn, pollGithubSignIn, signInWithToken, startGithubSignIn, type TokenFormState } from "@/app/(auth)/actions";
import { GitHubIcon } from "@/components/auth/brand-icons";
import { FormMessage } from "@/components/auth/form-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { SignInStep } from "@/lib/sign-in";

type View =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "waiting"; userCode: string; verificationUri: string }
  | { name: "denied" | "expired" }
  | { name: "error"; message: string };

/** The device-flow sign-in: shows GitHub's code, polls the server while the owner authorizes on github.com. */
export function GithubSignIn({ next }: { next?: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ name: "idle" });
  const [retryInMs, setRetryInMs] = useState(0);
  // Counts the polls: GitHub usually repeats the same interval, so the delay alone can't re-arm the timer.
  const [pollCount, setPollCount] = useState(0);
  const [copied, setCopied] = useState(false);

  function apply(step: SignInStep) {
    switch (step.status) {
      case "waiting":
        setView({ name: "waiting", userCode: step.userCode, verificationUri: step.verificationUri });
        setRetryInMs(step.retryInMs);
        setPollCount((count) => count + 1);
        break;
      case "pending":
        setRetryInMs(step.retryInMs);
        setPollCount((count) => count + 1);
        break;
      case "done":
        router.replace(step.next);
        break;
      case "adopt":
        router.replace("/sign-in/adopt");
        break;
      case "denied":
      case "expired":
        setView({ name: step.status });
        break;
      default:
        setView({ name: "error", message: step.message });
    }
  }

  async function start() {
    setView({ name: "starting" });
    setCopied(false);
    try {
      apply(await startGithubSignIn(next));
    } catch {
      setView({ name: "error", message: "We couldn't start the sign-in. Please try again." });
    }
  }

  async function cancel() {
    setView({ name: "idle" });
    await cancelGithubSignIn().catch(() => {});
  }

  const waiting = view.name === "waiting";
  // One timer per poll: the server says how long to wait (GitHub's interval, longer after slow_down).
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const step = await pollGithubSignIn();
        if (!cancelled) apply(step);
      } catch {
        if (!cancelled) setView({ name: "error", message: "We lost the connection to TechTeam. Please try again." });
      }
    }, retryInMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `apply` only calls setters and the router, so it isn't a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, retryInMs, pollCount]);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (view.name === "waiting") {
    return (
      <div className="flex flex-col gap-5">
        <div className="surface flex flex-col items-center gap-3 p-6 text-center">
          <p className="eyebrow text-muted-foreground">Your code</p>
          <p aria-label={`Your code is ${view.userCode.split("").join(" ")}`} className="text-4xl font-bold tracking-widest tabular-nums">
            {view.userCode}
          </p>
          <Button type="button" variant="outline" className="h-9" onClick={() => copy(view.userCode)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>
        <a
          href={view.verificationUri}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ className: "h-10 w-full bg-darkest text-lightest hover:bg-darkest/85" })}
        >
          <GitHubIcon className="size-4" />
          Open GitHub
          <ExternalLinkIcon />
        </a>
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Waiting for you to authorize…
        </p>
        <Button type="button" variant="ghost" className="h-9" onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {view.name === "denied" && <FormMessage message="You cancelled the authorization on GitHub. Start again whenever you're ready." />}
      {view.name === "expired" && <FormMessage message="That code expired before it was used. Start again to get a new one." />}
      {view.name === "error" && <FormMessage message={view.message} />}
      <Button type="button" onClick={start} disabled={view.name === "starting"} className="h-10 w-full bg-darkest text-lightest hover:bg-darkest/85">
        {view.name === "starting" ? <Spinner /> : <GitHubIcon className="size-4" />}
        {view.name === "starting" ? "Contacting GitHub…" : view.name === "idle" ? "Continue with GitHub" : "Try again"}
      </Button>
    </div>
  );
}

/** Secondary path for people who'd rather paste a token than use the device flow. */
export function PersonalTokenForm({ next }: { next?: string }) {
  const [state, dispatch, pending] = useActionState<TokenFormState, FormData>(signInWithToken, {});

  return (
    <details className="group rounded-xl border bg-card p-4 open:pb-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium outline-none focus-visible:text-brand-emphasis">
        <KeyRoundIcon className="size-4 text-muted-foreground" />
        Use a personal access token instead
      </summary>
      <form action={dispatch} className="mt-4 flex flex-col gap-3">
        <FormMessage message={state.message} />
        {next && <input type="hidden" name="next" value={next} />}
        <Field>
          <FieldLabel htmlFor="personal-token">Personal access token</FieldLabel>
          <Input id="personal-token" name="token" type="password" autoComplete="off" spellCheck={false} placeholder="ghp_…" className="h-10" required />
        </Field>
        <p className="text-xs text-muted-foreground">
          Create one on GitHub with the <span className="font-medium text-foreground">repo</span> scope. It is checked with GitHub, then stored
          encrypted on this computer.
        </p>
        <Button type="submit" variant="outline" className="h-10" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Checking token…" : "Sign in with token"}
        </Button>
      </form>
    </details>
  );
}
