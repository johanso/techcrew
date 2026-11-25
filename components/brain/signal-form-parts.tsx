import { SkillFindings } from "@/components/skills/skill-findings";
import type { MemoryScanFinding } from "@/lib/memory-scan";

/** Radio choices drawn as chips, for the signal dialogs: native radios, so keyboard and screen readers work as usual. */
export function ChipChoices<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex h-9 items-center rounded-full border bg-card px-3.5 text-sm font-medium transition-colors peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:text-brand-emphasis peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:border-brand/30">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Why the security scan refused a signal's text. */
export function RefusedFindings({ findings }: { findings?: MemoryScanFinding[] }) {
  if (!findings?.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/50 p-3">
      <p role="status" className="text-xs font-semibold">
        The security scan refused this text. Nothing was saved.
      </p>
      <SkillFindings findings={findings} />
    </div>
  );
}
