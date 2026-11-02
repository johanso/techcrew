"use client";

import { useState } from "react";

type FormStateWithErrors = { errors?: Partial<Record<string, string>> };

/**
 * Server-returned field errors that disappear as soon as the user edits that field.
 * Edits are tracked per result object, so a new submission shows its errors again.
 * Attach `onChange` to the <form>; fields are matched by their `name` attribute.
 */
export function useFieldErrors<S extends FormStateWithErrors>(state: S) {
  type FieldName = keyof NonNullable<S["errors"]> & string;

  const [edited, setEdited] = useState<{ state: S; names: Set<string> }>({
    state,
    names: new Set(),
  });
  const names = edited.state === state ? edited.names : new Set<string>();

  const onChange = (event: React.FormEvent<HTMLFormElement>) => {
    const name = (event.target as HTMLInputElement).name;
    if (!state.errors?.[name] || names.has(name)) return;
    setEdited({ state, names: new Set(names).add(name) });
  };

  const errorFor = (name: FieldName) => (names.has(name) ? undefined : state.errors?.[name]);

  return { errorFor, onChange };
}
