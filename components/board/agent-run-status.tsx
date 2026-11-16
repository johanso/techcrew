import {
  CircleAlertIcon,
  CircleStopIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { PROVIDERS } from "@/lib/agent-config";
import { PHASE_META, type BoardCardRun } from "@/lib/agent-run-config";
import { cn } from "@/lib/utils";

/** Label, icon and tone for a card's latest agent run. Tones color the icon only; the text stays neutral (contrast). */
export function runStatusMeta(run: BoardCardRun): { label: string; icon: LucideIcon; tone: string; spin?: boolean } {
  const pr = run.pullRequest ? `PR #${run.pullRequest.number}` : null;
  switch (run.status) {
    case "queued":
      return { label: "Queued for the agents", icon: LoaderCircleIcon, tone: "text-muted-foreground", spin: true };
    case "running":
      return { label: `${run.stage ? PHASE_META[run.stage].verb : "Working"}…`, icon: LoaderCircleIcon, tone: "text-action", spin: true };
    case "awaiting_merge":
      return { label: pr ? `${pr} ready to merge` : "Ready to merge", icon: GitPullRequestIcon, tone: "text-success" };
    case "completed":
      return { label: pr ? `Merged ${pr}` : "Completed", icon: GitMergeIcon, tone: "text-success" };
    case "needs_info":
      return { label: "Analyst needs info", icon: MessageCircleQuestionIcon, tone: "text-warning" };
    case "cancelled":
      return { label: "Stopped", icon: CircleStopIcon, tone: "text-muted-foreground" };
    case "failed":
      if (run.failure?.kind === "out_of_credit") {
        return { label: `Out of ${PROVIDERS[run.failure.provider].label} credit`, icon: WalletIcon, tone: "text-warning" };
      }
      return { label: "Agents stopped", icon: CircleAlertIcon, tone: "text-error" };
  }
}

/** One line on the card about its run, plus the reason when the agents stopped or need an answer. */
export function AgentRunStatus({ run, className }: { run: BoardCardRun; className?: string }) {
  const meta = runStatusMeta(run);
  const showReason = run.error && (run.status === "failed" || run.status === "needs_info" || run.status === "awaiting_merge");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg bg-muted/60 px-2.5 py-2 text-xs", className)}>
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <meta.icon aria-hidden className={cn("size-3.5 shrink-0", meta.tone, meta.spin && "animate-spin")} />
        <span className="truncate">{meta.label}</span>
      </span>
      {showReason && <p className="line-clamp-2 text-muted-foreground">{run.error}</p>}
    </div>
  );
}
