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
 * Above the board when cards stopped because a provider ran out of credit: which cards, and the way out — switch the
 * team to the other company and retry them, or add credit.
 */
export function CreditNotice({
  cards,
  provider,
  connected,
  settingsHref,
  retrying,
  onRetry,
}: {
  /** Cards whose latest run stopped for lack of credit. */
  cards: BoardCard[];
  /** The team's current provider. */
  provider: AgentProvider;
  connected: ProviderStatus;
  settingsHref: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const failure = cards.find((card) => card.run?.failure)?.run?.failure;
  if (!failure) return null;
  const broke = failure.provider;
  const other: AgentProvider = broke === "openai" ? "anthropic" : "openai";
  // Already moved (by hand or auto failover): retrying just runs them on the current provider.
  const switched = provider !== broke;
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
          {list} stopped. {switched ? `The team now works on ${PROVIDERS[provider].label}.` : canRetry ? `You can carry on with ${PROVIDERS[other].label}.` : `Add credit, or a ${PROVIDERS[other].label} key to switch.`}
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
            {retrying ? "Retrying…" : switched ? `Retry on ${PROVIDERS[provider].label}` : `Switch to ${PROVIDERS[other].label} and retry`}
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
