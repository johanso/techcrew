"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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

import { scanAgentAction, switchScanAgentAction } from "@/app/dashboard/[workspaceId]/ai-team/actions";
import { TrustRing } from "@/components/ai-team/agent-visuals";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_MODELS } from "@/lib/agent-config";
import { trustGrade, type TrustSeverity } from "@/lib/agent-trust";
import type { AgentView } from "@/lib/agents";
import { isPendingScan, type SwitchTrustStatus } from "@/lib/switch-trust-config";
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
 * Trust score for the configure dialog. With Switch Trust connected, "SwitchAgent Scan" queues one Switch
 * evaluation in the background (the page refreshes itself until the score lands); without it, "Scan again" runs
 * the rule scan plus an optional AI review. Both score the *saved* configuration, so they wait for unsaved changes.
 */
export function TrustPanel({
  agent,
  workspaceId,
  dirty,
  aiEnabled,
  switchTrust,
}: {
  agent: AgentView;
  workspaceId: number;
  dirty: boolean;
  aiEnabled: boolean;
  switchTrust: SwitchTrustStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const report = agent.trust;
  const grade = report ? trustGrade(report.score) : null;
  const modelLabel = report?.model ? (AGENT_MODELS.find((m) => m.id === report.model)?.label ?? report.model) : null;
  const scan = agent.scan;
  const scanning = scan !== null && isPendingScan(scan.status);
  // A failed scan matters only while it's newer than the score on screen.
  const scanFailed = scan?.status === "failed" && (!report || scan.createdAt > report.scannedAt) ? scan : null;
  const outdated = report?.mode === "switch" && agent.configuredAt > report.scannedAt;

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
          {switchTrust.connected ? "Switch Trust Score" : "Skill Trust Score"}
        </h3>
        {report?.mode === "switch" ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-emphasis">
            <RadarIcon className="size-3" />
            SwitchAgent
          </span>
        ) : report?.mode === "ai" ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-emphasis">
            <SparklesIcon className="size-3" />
            AI-assisted
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-5">
        {scanning && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-brand/8 p-3 text-xs font-medium ring-1 ring-brand/20">
            <Spinner className="size-3.5 text-brand-emphasis" />
            <span>
              {scan.status === "queued" ? "SwitchAgent scan queued…" : "Switch is evaluating this agent…"}{" "}
              <span className="font-normal text-muted-foreground">The score updates here when it&apos;s ready.</span>
            </span>
          </p>
        )}
        {scanFailed && !scanning && (
          <p role="status" className="flex gap-2 rounded-lg bg-error/8 p-3 text-xs ring-1 ring-error/20">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-error" />
            <span>
              <span className="font-semibold">SwitchAgent scan failed.</span> {scanFailed.error}
            </span>
          </p>
        )}

        {report && grade ? (
          <>
            <div className={cn("flex items-center gap-4 transition-opacity", (pending || scanning) && "opacity-50")}>
              <TrustRing score={report.score} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className={cn("text-sm font-bold", grade.tone)}>{grade.label}</p>
                <p className="text-xs text-muted-foreground">{report.summary}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {report.mode === "switch" ? `${report.checksPassed}/${report.checksTotal} tests held` : `${report.checksPassed}/${report.checksTotal} checks passed`}
              </span>
              <time dateTime={report.scannedAt} title={new Date(report.scannedAt).toLocaleString()} suppressHydrationWarning>
                {report.mode === "switch" ? "Switch Trust · " : modelLabel ? `${modelLabel} · ` : "Rule-based · "}
                {ago(report.scannedAt)}
              </time>
            </div>

            {report.mode === "switch" && report.coverage != null && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">OWASP risk coverage</span>
                  <span className="font-semibold tabular-nums">{report.coverage}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-success" style={{ width: `${report.coverage}%` }} />
                </div>
              </div>
            )}

            {outdated && (
              <p className="flex gap-2 text-xs text-muted-foreground">
                <InfoIcon className="mt-px size-3.5 shrink-0 text-action" />
                The configuration changed after this scan. Run a SwitchAgent Scan to score the current one.
              </p>
            )}

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
                {report.mode === "switch" ? "Every test held. Nothing to fix." : "Every check passed. Nothing to fix."}
              </p>
            )}
          </>
        ) : (
          !scanning && <p className="text-sm text-muted-foreground">This agent hasn&apos;t been scanned yet.</p>
        )}

        {message && (
          <p role="status" className={cn("text-xs font-medium", message.tone === "error" ? "text-error" : "text-foreground")}>
            {message.tone === "warning" && <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px] text-warning" />}
            {message.text}
          </p>
        )}

        {switchTrust.connected ? (
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full"
              onClick={() => run(() => switchScanAgentAction(workspaceId, agent.id))}
              disabled={pending || dirty || scanning || switchTrust.problem !== null}
            >
              {pending || scanning ? <Spinner /> : <RadarIcon data-icon="inline-start" />}
              {pending ? "Queuing scan…" : scanning ? "Scanning…" : "SwitchAgent Scan"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              {dirty
                ? "Save your changes to scan them."
                : (switchTrust.problem ?? "One Switch Trust evaluation, run in the background.")}
            </p>
          </div>
        ) : (
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
                  : "Rule checks only. Add an API key in Settings → AI providers for an AI review."}{" "}
              <Link href={`/dashboard/${workspaceId}/settings#switch`} className="font-medium text-brand-emphasis hover:underline">
                Connect Switch Trust
              </Link>{" "}
              for SwitchAgent scans.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
