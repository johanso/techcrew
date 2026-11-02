"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

const STRENGTH = [
  { label: "Too short", color: "bg-destructive" },
  { label: "Weak", color: "bg-destructive" },
  { label: "Fair", color: "bg-warning" },
  { label: "Good", color: "bg-success/70" },
  { label: "Strong", color: "bg-success" },
];

function scorePassword(password: string) {
  if (password.length < 8) return 0;
  let score = 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) score++;
  return score;
}

export function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  const { label, color } = STRENGTH[score];

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 rounded-full transition-colors duration-300",
              password && step <= Math.max(score, 1) ? color : "bg-muted"
            )}
          />
        ))}
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">
        {password ? label : "8+ chars"}
      </span>
    </div>
  );
}
