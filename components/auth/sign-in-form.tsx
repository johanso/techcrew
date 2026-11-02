"use client";

import { useActionState } from "react";

import { signIn, type AuthFormState } from "@/app/(auth)/actions";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { PasswordInput } from "@/components/auth/password-input";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, {});
  const { errorFor, onChange } = useFieldErrors(state);

  return (
    <form action={action} onChange={onChange} noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FieldGroup className="gap-4">
        <FormMessage message={state.message} />

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
            autoFocus
            required
          />
          <FieldError>{errorFor("email")}</FieldError>
        </Field>

        <Field data-invalid={!!errorFor("password")}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={!!errorFor("password")}
            className="h-10"
            required
          />
          <FieldError>{errorFor("password")}</FieldError>
        </Field>

        <SubmitButton pending={pending}>{pending ? "Signing in…" : "Sign in"}</SubmitButton>
      </FieldGroup>
    </form>
  );
}
