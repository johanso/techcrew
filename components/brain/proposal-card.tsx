"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { CheckIcon, ExternalLinkIcon, FolderGitIcon, PencilIcon, ShieldAlertIcon, TriangleAlertIcon, UserCheckIcon, BotIcon, XIcon } from "lucide-react";

import { acceptProposalAction, rejectProposalAction } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { CheckRow } from "@/components/brain/check-row";
import { ProposalEditDialog } from "@/components/brain/proposal-edit-dialog";
import { SIGNAL_ICON } from "@/components/brain/signal-icons";
import { Pill } from "@/components/skills/skill-badges";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MEMORY_TYPE_META } from "@/lib/memory-config";
import { PROPOSAL_KIND_LABEL, type ProposalNote, type ProposalView } from "@/lib/memory-proposals";
import { SIGNAL_KIND_LABEL, SIGNALS_PER_WORKSPACE_MAX } from "@/lib/memory-signals";
import { cn } from "@/lib/utils";

export const proposalTitle = (proposal: ProposalView) => proposal.note?.title ?? proposal.current?.title ?? "A note";

function NotePanel({ label, note, muted }: { label: string; note: ProposalNote; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/50 p-3">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold wrap-anywhere", muted && "text-muted-foreground")}>{note.title}</p>
      <p className="text-xs wrap-anywhere text-muted-foreground">
        {MEMORY_TYPE_META[note.type].label} · {note.load === "always" ? "Always loaded" : "On demand"}
        {note.paths.length > 0 && (
          <>
            {" "}
            · Relevant to <span className="font-mono">{note.paths.join(", ")}</span>
          </>
        )}
      </p>
      <p className={cn("text-sm wrap-anywhere whitespace-pre-wrap", muted ? "text-muted-foreground" : "text-foreground/90")}>{note.body}</p>
    </div>
  );
}

const linkClass = "inline-flex items-center gap-1 font-medium text-foreground hover:underline";

function Evidence({ workspaceId, proposal }: { workspaceId: number; proposal: ProposalView }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {proposal.evidence.map((evidence) => {
        if (evidence.kind === "repository") {
          return (
            <li key="repository" className="flex min-w-0 gap-2 text-xs">
              <FolderGitIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand-emphasis" />
              <span className="min-w-0 wrap-anywhere text-muted-foreground">
                <span className="font-semibold text-foreground">The repository:</span> <span className="font-mono">{evidence.files.join(", ")}</span>
              </span>
            </li>
          );
        }
        const { icon: Icon, tone } = SIGNAL_ICON[evidence.kind];
        return (
          <li key={evidence.signalId} className="flex min-w-0 gap-2 text-xs">
            <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">{SIGNAL_KIND_LABEL[evidence.kind]}</span>
                {evidence.trusted ? (
                  <Pill className="bg-success/10 text-foreground ring-success/30" title="You typed this in TechTeam.">
                    <UserCheckIcon aria-hidden className="size-3" />
                    Trusted
                  </Pill>
                ) : (
                  <Pill title="Not typed by you: written by an agent, CI or GitHub.">
                    <BotIcon aria-hidden className="size-3" />
                    From an agent
                  </Pill>
                )}
              </p>
              {evidence.summary && <p className="line-clamp-3 wrap-anywhere text-muted-foreground">{evidence.summary}</p>}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                {evidence.card && (
                  <Link href={`/dashboard/${workspaceId}/board?log=${evidence.card.id}`} className={linkClass}>
                    {evidence.card.key}
                  </Link>
                )}
                {evidence.prUrl && (
                  <a href={evidence.prUrl} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "tabular-nums")}>
                    PR #{evidence.prNumber}
                    <ExternalLinkIcon aria-hidden className="size-3" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
                {/* The whole list, so the entry is there however old it is. */}
                <Link href={`/dashboard/${workspaceId}/brain?signals=${SIGNALS_PER_WORKSPACE_MAX}#signal-${evidence.signalId}`} className={linkClass}>
                  In Activity
                </Link>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One proposal waiting for the owner: what it changes (next to the note as it is now), why, what it rests on, and what
 * can be done with it. `delivery` depends on the memory mode: accept here, choose it for the pull request, or nothing
 * while memory is off. One based only on untrusted text asks for a confirmation first.
 */
export function ProposalCard({
  workspaceId,
  proposal,
  delivery,
  confirmed,
  onConfirm,
  selected,
  onSelect,
}: {
  workspaceId: number;
  proposal: ProposalView;
  delivery: "inbox" | "pull_request" | null;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [action, setAction] = useState<"accept" | "reject" | null>(null);
  const [pending, startTransition] = useTransition();
  const closeEditor = useCallback(() => setEditing(false), []);

  const run = (kind: "accept" | "reject") =>
    startTransition(async () => {
      setAction(kind);
      setMessage(undefined);
      const failed = "Something went wrong. Please try again.";
      if (kind === "reject") {
        const result = await rejectProposalAction(workspaceId, proposal.id).catch(() => ({ ok: false, message: failed }));
        if (!result.ok) setMessage(result.message);
        return;
      }
      const data = new FormData();
      if (confirmed) data.set("confirmed", "on");
      const result = await acceptProposalAction(workspaceId, proposal.id, {}, data).catch(() => ({ ok: false, message: failed }));
      if (!result.ok) setMessage(result.message);
    });

  const blocked = proposal.untrustedOrigin && !confirmed;
  const title = proposalTitle(proposal);
  const where = proposal.scope === "global" ? "Everything" : "This project";

  return (
    <li className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-1">
          <Pill className="bg-brand/8 text-brand-emphasis ring-brand/20">{PROPOSAL_KIND_LABEL[proposal.kind]}</Pill>
          <Pill title={proposal.scope === "global" ? "Your own memory: every project reads it." : "This project's notes."}>{where}</Pill>
          {proposal.origin === "bootstrap" && <Pill>From the repository</Pill>}
        </p>
        <h3 className="text-sm font-bold wrap-anywhere">{title}</h3>
      </div>

      {proposal.untrustedOrigin && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <ShieldAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Based only on text from agents, CI or the repository
          </p>
          {delivery && (
            <CheckRow checked={confirmed} onChange={onConfirm} disabled={pending}>
              I checked this note against its evidence
              <span className="sr-only">: {title}</span>
            </CheckRow>
          )}
        </div>
      )}
      {proposal.targetChanged && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          The note it changes was edited or removed since this was proposed, so it will be marked as superseded instead.
        </p>
      )}

      <div className={cn("grid gap-3", proposal.kind === "update" && "md:grid-cols-2")}>
        {proposal.current && <NotePanel label={proposal.kind === "retire" ? "Current note, to be retired" : "Now"} note={proposal.current} muted />}
        {proposal.note && <NotePanel label="Proposed" note={proposal.note} />}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="eyebrow text-muted-foreground">Why</p>
        <p className="text-sm wrap-anywhere">{proposal.rationale}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="eyebrow text-muted-foreground">Based on</p>
        <Evidence workspaceId={workspaceId} proposal={proposal} />
      </div>

      <FormMessage message={message} />
      {delivery && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {delivery === "pull_request" && (
            <div className="sm:mr-auto">
              <CheckRow checked={selected} onChange={onSelect} disabled={blocked || pending}>
                Add to the pull request
                <span className="sr-only">: {title}</span>
              </CheckRow>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {delivery === "inbox" && (
              <Button type="button" className="h-9" disabled={pending || blocked} onClick={() => run("accept")}>
                {pending && action === "accept" ? <Spinner /> : <CheckIcon data-icon="inline-start" />}
                {pending && action === "accept" ? "Accepting…" : proposal.kind === "retire" ? "Accept and retire" : "Accept"}
              </Button>
            )}
            {proposal.note && (
              <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => setEditing(true)}>
                <PencilIcon data-icon="inline-start" />
                {delivery === "inbox" ? "Edit then accept" : "Edit"}
              </Button>
            )}
            <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => run("reject")}>
              {pending && action === "reject" ? <Spinner /> : <XIcon data-icon="inline-start" />}
              {pending && action === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      )}
      {delivery && proposal.note && (
        <ProposalEditDialog
          workspaceId={workspaceId}
          proposal={proposal}
          accepts={delivery === "inbox"}
          confirmed={confirmed}
          onConfirm={onConfirm}
          open={editing}
          onClose={closeEditor}
        />
      )}
    </li>
  );
}
