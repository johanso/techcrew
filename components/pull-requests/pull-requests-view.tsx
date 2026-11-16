import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";
import { MergeButton } from "@/components/pull-requests/merge-button";
import { buttonVariants } from "@/components/ui/button";
import type { MergeMode, RiskLevel } from "@/lib/agent-run-config";
import type { PullRequestView } from "@/lib/pull-requests";
import { cn } from "@/lib/utils";

const STATE: Record<PullRequestView["state"], { icon: LucideIcon; tone: string; label: string }> = {
  open: { icon: GitPullRequestIcon, tone: "text-success", label: "Open" },
  merged: { icon: GitMergeIcon, tone: "text-brand-emphasis", label: "Merged" },
  closed: { icon: GitPullRequestClosedIcon, tone: "text-error", label: "Closed" },
};

const VERDICT: Record<"pending" | "pass" | "fail", { icon: LucideIcon; tone: string }> = {
  pending: { icon: CircleDashedIcon, tone: "text-muted-foreground" },
  pass: { icon: CircleCheckIcon, tone: "text-success" },
  fail: { icon: CircleXIcon, tone: "text-error" },
};

/** "Review: approved" / "Tests: failed" chip. Color sits on the icon; the text stays neutral for contrast. */
function VerdictChip({ label, value, verdict }: { label: string; value: string; verdict: keyof typeof VERDICT }) {
  const meta = VERDICT[verdict];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs ring-1 ring-border/70">
      <meta.icon aria-hidden className={cn("size-3.5", meta.tone)} />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

const RISK: Record<RiskLevel, { icon: LucideIcon; tone: string; label: string }> = {
  low: { icon: ShieldCheckIcon, tone: "text-success", label: "Low" },
  medium: { icon: ShieldIcon, tone: "text-warning", label: "Medium" },
  high: { icon: ShieldAlertIcon, tone: "text-error", label: "High" },
};

/** The Lead's risk rating, same chip shape as the verdicts. */
function RiskChip({ risk }: { risk: RiskLevel }) {
  const meta = RISK[risk];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs ring-1 ring-border/70">
      <meta.icon aria-hidden className={cn("size-3.5", meta.tone)} />
      <span className="text-muted-foreground">Risk:</span>
      <span className="font-medium">{meta.label}</span>
    </span>
  );
}

const DESCRIPTION: Record<MergeMode, string> = {
  manual: "Changes your agents propose. Merge them here once the Lead approves and tests pass.",
  auto_low_risk: "Changes your agents propose. Low-risk ones merge automatically once tests and CI pass; the rest wait for you here.",
  auto: "Changes your agents propose. They merge automatically once the Lead approves and tests and CI pass.",
};

function PullRequestRow({ pr, workspaceId }: { pr: PullRequestView; workspaceId: number }) {
  const state = STATE[pr.state];
  return (
    <li className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      <span className={cn("icon-tile size-9 shrink-0 rounded-lg [&_svg]:size-4.5", state.tone)} title={state.label}>
        <state.icon aria-hidden />
        <span className="sr-only">{state.label}</span>
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold hover:underline">
            {pr.title}
          </a>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{pr.number}</span>
        </div>
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{pr.headBranch}</span>→<span className="font-mono">{pr.baseBranch}</span>
          </span>
          {pr.task && (
            <Link href={`/dashboard/${workspaceId}/board`} className="truncate font-medium text-foreground hover:underline" title={pr.task.title}>
              {pr.task.key}
            </Link>
          )}
          <span>
            {pr.mergedAt
              ? `merged ${formatDistanceToNowStrict(new Date(pr.mergedAt), { addSuffix: true })}`
              : `opened ${formatDistanceToNowStrict(new Date(pr.createdAt), { addSuffix: true })}`}
          </span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <VerdictChip
            label="Approval"
            value={pr.reviewStatus === "approved" ? "Approved" : pr.reviewStatus === "changes_requested" ? "Changes requested" : "Pending"}
            verdict={pr.reviewStatus === "approved" ? "pass" : pr.reviewStatus === "changes_requested" ? "fail" : "pending"}
          />
          <VerdictChip
            label="Tests"
            value={pr.testStatus === "passed" ? "Passed" : pr.testStatus === "failed" ? "Failed" : "Pending"}
            verdict={pr.testStatus === "passed" ? "pass" : pr.testStatus === "failed" ? "fail" : "pending"}
          />
          {pr.risk && <RiskChip risk={pr.risk} />}
        </div>
        {pr.mergeError && pr.state === "open" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-error" />
            <span className="line-clamp-2">{pr.mergeError}</span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {pr.state === "open" && pr.canMerge && <MergeButton workspaceId={workspaceId} pullRequestId={pr.id} />}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "icon", className: "size-9" })}
          aria-label={`Open PR #${pr.number} on GitHub`}
        >
          <ExternalLinkIcon />
        </a>
      </div>
    </li>
  );
}

/** Pull Requests page content. Presentational: the page loads (and refreshes) the data. */
export function PullRequestsView({
  workspace,
  pullRequests,
}: {
  workspace: { id: number; repoUrl: string; mergeMode: MergeMode };
  pullRequests: PullRequestView[];
}) {
  const githubLink = (
    <a
      href={`${workspace.repoUrl}/pulls`}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonVariants({ variant: "outline", className: "h-9" })}
    >
      View on GitHub
      <ExternalLinkIcon data-icon="inline-end" />
    </a>
  );
  const open = pullRequests.filter((pr) => pr.state === "open");
  const ready = open.filter((pr) => pr.canMerge).length;

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Pull Requests"
        description={DESCRIPTION[workspace.mergeMode]}
        actions={githubLink}
      />

      {pullRequests.length === 0 ? (
        <SectionEmpty
          icon={GitPullRequestIcon}
          title="No agent pull requests yet"
          description="When the Developer finishes a card, its pull request appears here with the approval, test results and risk."
        />
      ) : (
        <section className="surface min-w-0" aria-labelledby="pr-list-title">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 px-5 py-4">
            <h2 id="pr-list-title" className="text-base font-bold">
              Agent pull requests
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {open.length} open{ready ? ` · ${ready} ready to merge` : ""}
            </p>
          </div>
          <ul className="divide-y divide-border/70">
            {pullRequests.map((pr) => (
              <PullRequestRow key={pr.id} pr={pr} workspaceId={workspace.id} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
