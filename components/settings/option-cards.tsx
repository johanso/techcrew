"use client";

import type { LucideIcon } from "lucide-react";

import { FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type OptionCard<T extends string> = { value: T; icon: LucideIcon; label: string; description: string; disabled?: boolean };

/** A radio group drawn as cards (Settings). Native radios underneath, so keyboard and screen readers work as usual. */
export function OptionCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: OptionCard<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <FieldSet className="gap-2.5">
      <FieldLegend variant="label">{legend}</FieldLegend>
      <div role="radiogroup" aria-label={legend} className={cn("grid gap-2", options.length === 3 ? "md:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((option) => (
          <label key={option.value} className={cn("relative", option.disabled ? "cursor-not-allowed" : "cursor-pointer")}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex h-full items-start gap-3 rounded-lg border bg-card p-3.5 transition-colors",
                "peer-checked:border-brand/50 peer-checked:bg-brand/5 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                option.disabled ? "opacity-60" : "hover:bg-accent"
              )}
            >
              <span className="icon-tile size-8 shrink-0 rounded-lg text-brand-emphasis [&_svg]:size-4">
                <option.icon aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </FieldSet>
  );
}
