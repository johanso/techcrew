"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { MailCheckIcon } from "lucide-react";

import { signUp, type AuthFormState } from "@/app/(auth)/actions";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { PasswordInput, PasswordStrength } from "@/components/auth/password-input";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});
  // Controlled so the strength meter can follow it and it survives a failed submit.
  const [password, setPassword] = useState("");
  const { errorFor, onChange } = useFieldErrors(state);

  if (state.status === "verify-email") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/30 px-6 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
          <MailCheckIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">Check your inbox</h2>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline", className: "h-10 w-full" })}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} onChange={onChange} noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FieldGroup className="gap-4">
        <FormMessage message={state.message} />

        <Field data-invalid={!!errorFor("name")}>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            defaultValue={state.fields?.name}
            aria-invalid={!!errorFor("name")}
            className="h-10"
            autoFocus
            required
          />
          <FieldError>{errorFor("name")}</FieldError>
        </Field>

        <Field data-invalid={!!errorFor("email")}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            defaultValue={state.fields?.email}
            aria-invalid={!!errorFor("email")}
            className="h-10"
            required
          />
          <FieldError>{errorFor("email")}</FieldError>
        </Field>

        <Field data-invalid={!!errorFor("password")}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={!!errorFor("password")}
            aria-describedby="password-strength"
            className="h-10"
            minLength={8}
            required
          />
          <div id="password-strength">
            <PasswordStrength password={password} />
          </div>
          <FieldError>{errorFor("password")}</FieldError>
        </Field>

        <SubmitButton pending={pending}>{pending ? "Creating account…" : "Create account"}</SubmitButton>
      </FieldGroup>
    </form>
  );
}
