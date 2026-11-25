import { CheckIcon } from "lucide-react";

/** A checkbox with its sentence: a native input drawn as a box, so keyboard and screen readers work as usual. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  name,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border bg-card text-transparent transition-colors peer-checked:border-brand peer-checked:bg-brand peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
      >
        <CheckIcon className="size-3" />
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}
