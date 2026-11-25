"use client";

import { useState, useTransition } from "react";
import { BanIcon, CircleCheckIcon, ExternalLinkIcon, GitPullRequestIcon, InboxIcon, RefreshCwIcon } from "lucide-react";

import { openMemoryPullRequestAction, refreshMemoryPullRequestsAction } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { ProposalCard, proposalTitle } from "@/components/brain/proposal-card";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MEMORY_DIR, type MemoryMode } from "@/lib/memory-config";
import { PROPOSAL_KIND_LABEL, deliveryOf, type ProposalView } from "@/lib/memory-proposals";

const toggled = (set: ReadonlySet<number>, id: number, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

type Notice = { ok: boolean; message?: string };

/**
 * Brain → Proposals: what the librarian suggests, waiting for the owner. Accepted here, or (project notes in mode `repo`)
 * chosen and sent to the repository in the memory pull request, which only this button opens.
 */
export function ProposalInbox({ workspaceId, mode, proposals }: { workspaceId: number; mode: MemoryMode; proposals: ProposalView[] }) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirmed, setConfirmed] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<"open" | "check" | null>(null);
  const [pending, startTransition] = useTransition();

  const waiting = proposals.filter((proposal) => proposal.status === "pending");
  const sent = proposals.filter((proposal) => proposal.status === "in_pr");
  const forPullRequest = waiting.filter((proposal) => deliveryOf(proposal.scope, mode) === "pull_request");
  // Only what is still waiting counts, whatever was ticked before it was decided.
  const chosen = forPullRequest.filter((proposal) => selected.has(proposal.id) && (!proposal.untrustedOrigin || confirmed.has(proposal.id)));
  const openNumber = Math.max(0, ...sent.map((proposal) => proposal.pullRequest?.number ?? 0));

  const send = (kind: "open" | "check") =>
    startTransition(async () => {
      setAction(kind);
      setNotice(null);
      const failed = { ok: false, message: "Something went wrong. Please try again." };
      const result =
        kind === "open"
          ? await openMemoryPullRequestAction(
              workspaceId,
              chosen.map((proposal) => proposal.id),
              chosen.filter((proposal) => confirmed.has(proposal.id)).map((proposal) => proposal.id)
            ).catch(() => failed)
          : await refreshMemoryPullRequestsAction(workspaceId).catch(() => failed);
      setNotice(result);
      if (kind === "open" && result.ok) setSelected(new Set());
    });

  const confirm = (proposal: ProposalView, on: boolean) => {
    setConfirmed((current) => toggled(current, proposal.id, on));
    // Confirming one that goes to the repository also chooses it; taking the confirmation back lets go of it.
    if (deliveryOf(proposal.scope, mode) === "pull_request") setSelected((current) => toggled(current, proposal.id, on));
  };

  return (
    <section id="proposals" className="surface flex min-w-0 flex-col" aria-label="Proposals">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <InboxIcon />
          </span>
        }
        title="Proposals"
        description={waiting.length ? `${waiting.length} waiting for you` : "Changes to the notes wait here for you."}
        actions={
          sent.length > 0 && (
            <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => send("check")}>
              {pending && action === "check" ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
              {pending && action === "check" ? "Checking…" : "Check GitHub"}
            </Button>
          )
        }
      />
      {mode === "off" && waiting.length > 0 && (
        <p className="flex items-start gap-2 border-b border-border/70 bg-muted/60 px-6 py-3 text-sm">
          <BanIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          Memory is off for this project. The proposals are kept; turn memory on to decide on them.
        </p>
      )}
      {notice?.message && (
        <div className="border-b border-border/70 px-6 py-4">
          {notice.ok ? (
            <p role="status" className="flex items-start gap-2 text-sm">
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              {notice.message}
            </p>
          ) : (
            <FormMessage message={notice.message} />
          )}
        </div>
      )}

      {sent.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-border/70 px-6 py-4">
          <p className="eyebrow text-muted-foreground">In the memory pull request</p>
          <ul className="flex flex-col gap-2">
            {sent.map((proposal) => (
              <li key={proposal.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <GitPullRequestIcon aria-hidden className="size-4 shrink-0 text-brand-emphasis" />
                <span className="min-w-0 flex-1 basis-40 truncate">
                  <span className="text-muted-foreground">{PROPOSAL_KIND_LABEL[proposal.kind]}:</span> {proposalTitle(proposal)}
                </span>
                {proposal.pullRequest ? (
                  <a href={proposal.pullRequest.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium tabular-nums hover:underline">
                    PR #{proposal.pullRequest.number}
                    <ExternalLinkIcon aria-hidden className="size-3" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Being sent…</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Merge or close it on GitHub. Merged notes reach the agents; closing it rejects them.</p>
        </div>
      )}

      {waiting.length ? (
        <ul className="flex flex-col divide-y divide-border/70">
          {waiting.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              workspaceId={workspaceId}
              proposal={proposal}
              delivery={deliveryOf(proposal.scope, mode)}
              confirmed={confirmed.has(proposal.id)}
              onConfirm={(on) => confirm(proposal, on)}
              selected={selected.has(proposal.id)}
              onSelect={(on) => setSelected((current) => toggled(current, proposal.id, on))}
            />
          ))}
        </ul>
      ) : (
        <SurfaceEmpty icon={InboxIcon} title="Nothing waiting" description="When the librarian suggests adding, changing or retiring a note, you decide here." />
      )}

      {forPullRequest.length > 0 && (
        // Sticks to the bottom of the panel, so the choice and the button stay in view down a long list.
        <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-xl border-t border-border/70 bg-card px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{chosen.length} selected.</span> Nothing reaches the repository until you press this. The pull request changes only{" "}
            <span className="font-mono">{MEMORY_DIR}/</span> and TechTeam never merges it.
          </p>
          <Button type="button" className="h-10 shrink-0" disabled={pending || !chosen.length} onClick={() => send("open")}>
            {pending && action === "open" ? <Spinner /> : <GitPullRequestIcon data-icon="inline-start" />}
            {pending && action === "open" ? "Opening pull request…" : openNumber ? `Add to pull request #${openNumber}` : "Open memory pull request"}
          </Button>
        </div>
      )}
    </section>
  );
}
