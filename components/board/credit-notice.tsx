"use client";

import Link from "next/link";
import { ArrowLeftRightIcon, ExternalLinkIcon, WalletIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PROVIDERS, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import type { BoardCard } from "@/lib/board-config";

const BILLING_URL: Record<AgentProvider, string> = {
  openai: "https://platform.openai.com/settings/organization/billing",
  anthropic: "https://platform.claude.com/settings/billing",
};

/**
 * Above the board when cards stopped because a provider ran out of credit: which cards, and the way out — move the
 * agents on that company to the other one and retry them, or add credit.
 */
export function CreditNotice({
  cards,
  inUse,
  connected,
  settingsHref,
  retrying,
  onRetry,
}: {
  /** Cards whose latest run stopped for lack of credit. */
  cards: BoardCard[];
  /** The companies the agents run on now. */
  inUse: ProviderStatus;
  connected: ProviderStatus;
  settingsHref: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const failure = cards.find((card) => card.run?.failure)?.run?.failure;
  if (!failure) return null;
  const broke = failure.provider;
  const other: AgentProvider = broke === "openai" ? "anthropic" : "openai";
  // No agent left on the broke company (moved by hand or auto failover): retrying just runs the cards again.
  const switched = !inUse[broke];
  const canRetry = switched || connected[other];
  const keys = cards.map((card) => card.key);
  const list = keys.length > 3 ? `${keys.slice(0, 3).join(", ")} and ${keys.length - 3} more` : keys.join(keys.length === 2 ? " and " : ", ");

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/8 px-4 py-3 text-sm sm:flex-row sm:items-center"
    >
      <WalletIcon className="hidden size-5 shrink-0 text-warning sm:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold">{PROVIDERS[broke].label} is out of credit</p>
        <p className="text-muted-foreground">
          {list} stopped. {switched ? `No agent works on ${PROVIDERS[broke].label} now.` : canRetry ? `You can carry on with ${PROVIDERS[other].label}.` : `Add credit, or a ${PROVIDERS[other].label} key to switch.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={BILLING_URL[broke]} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Add credit
          <ExternalLinkIcon data-icon="inline-end" />
        </a>
        {canRetry ? (
          <Button size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? <Spinner /> : <ArrowLeftRightIcon data-icon="inline-start" />}
            {retrying ? "Retrying…" : switched ? "Retry" : `Move agents to ${PROVIDERS[other].label} and retry`}
          </Button>
        ) : (
          <Link href={settingsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Add a {PROVIDERS[other].label} key
          </Link>
        )}
      </div>
    </div>
  );
}
