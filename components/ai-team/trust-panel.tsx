"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonAlertIcon,
  RadarIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { scanAgentAction } from "@/app/dashboard/[workspaceId]/ai-team/actions";
import { TrustRing } from "@/components/ai-team/agent-visuals";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trustGrade, type TrustSeverity } from "@/lib/agent-trust";
import type { AgentView } from "@/lib/agents";
import { cn } from "@/lib/utils";

const SEVERITY: Record<TrustSeverity, { icon: LucideIcon; tone: string; label: string }> = {
  critical: { icon: OctagonAlertIcon, tone: "text-error", label: "Critical" },
  high: { icon: TriangleAlertIcon, tone: "text-error", label: "High" },
  medium: { icon: TriangleAlertIcon, tone: "text-warning", label: "Medium" },
  low: { icon: InfoIcon, tone: "text-action", label: "Low" },
  info: { icon: InfoIcon, tone: "text-muted-foreground", label: "Info" },
};

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

/**
 * Trust score for the configure dialog. "Scan again" runs the rule scan plus an optional AI review. It scores the
 * *saved* configuration, so it waits for unsaved changes.
 */
export function TrustPanel({
  agent,
  workspaceId,
  dirty,
  aiEnabled,
}: {
  agent: AgentView;
  workspaceId: number;
  dirty: boolean;
  aiEnabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const report = agent.trust;
  const grade = report ? trustGrade(report.score) : null;
  const modelLabel = agent.trustModelLabel;

  const run = (action: () => Promise<{ ok: true; notice?: string } | { ok: false; error: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else if (result.notice) setMessage({ tone: "warning", text: result.notice });
    });
  };

  return (
    <section className="surface flex flex-col" aria-labelledby="trust-title">
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3.5">
        <ShieldCheckIcon className="size-4 text-brand-emphasis" />
        <h3 id="trust-title" className="text-sm font-bold">
          Trust Score
        </h3>
        {report?.mode === "ai" ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-emphasis">
            <SparklesIcon className="size-3" />
            AI-assisted
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-5">
        {report && grade ? (
          <>
            <div className={cn("flex items-center gap-4 transition-opacity", pending && "opacity-50")}>
              <TrustRing score={report.score} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className={cn("text-sm font-bold", grade.tone)}>{grade.label}</p>
                <p className="text-xs text-muted-foreground">{report.summary}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {report.checksPassed}/{report.checksTotal} checks passed
              </span>
              <time dateTime={report.scannedAt} title={new Date(report.scannedAt).toLocaleString()} suppressHydrationWarning>
                {modelLabel ? `${modelLabel} · ` : "Rule-based · "}
                {ago(report.scannedAt)}
              </time>
            </div>

            {report.findings.length ? (
              <ul className="flex flex-col gap-2" aria-label="Findings">
                {report.findings.map((finding) => {
                  const severity = SEVERITY[finding.severity];
                  return (
                    <li key={finding.id} className="flex gap-2.5 rounded-lg bg-muted/50 p-3 ring-1 ring-border/60">
                      <severity.icon className={cn("mt-0.5 size-4 shrink-0", severity.tone)} aria-hidden />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-xs font-semibold">
                          <span className="sr-only">{severity.label}: </span>
                          {finding.title}
                          {finding.source === "ai" && (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold text-brand-emphasis">AI</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{finding.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-xs font-medium ring-1 ring-success/20">
                <CircleCheckIcon className="size-4 shrink-0 text-success" />
                Every check passed. Nothing to fix.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This agent hasn&apos;t been scanned yet.</p>
        )}

        {message && (
          <p role="status" className={cn("text-xs font-medium", message.tone === "error" ? "text-error" : "text-foreground")}>
            {message.tone === "warning" && <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px] text-warning" />}
            {message.text}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" className="h-9 w-full" onClick={() => run(() => scanAgentAction(workspaceId, agent.id))} disabled={pending || dirty}>
            {pending ? <Spinner /> : <RadarIcon data-icon="inline-start" />}
            {pending ? "Scanning…" : "Scan again"}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            {dirty
              ? "Save your changes to scan them."
              : aiEnabled
                ? "Rule checks plus an AI security review."
                : "Rule checks only. Add an API key in Settings → AI providers for an AI review."}
          </p>
        </div>
      </div>
    </section>
  );
}
