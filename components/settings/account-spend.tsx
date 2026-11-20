import { WalletIcon } from "lucide-react";

import { AgentAvatar } from "@/components/dashboard/agent-avatar";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { BarList } from "@/components/metrics/bar-list";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { AGENT_ROLES, formatMicros } from "@/lib/agent-config";
import type { AccountSpend } from "@/lib/agents";
import { formatTokens } from "@/lib/cli-agents-config";

type SpendWorkspace = { id: number; icon: string; logoSrc: string | null };

/**
 * Settings → Your account: this month's model spend across every project, by project and by agent. Each project's
 * own spend stays on its AI Team page; this is the sum.
 */
export function AccountSpendCard({ spend, workspaces }: { spend: AccountSpend; workspaces: SpendWorkspace[] }) {
  const month = new Date(spend.monthStart).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const byId = new Map(workspaces.map((w) => [w.id, w]));

  return (
    <section id="usage" className="surface min-w-0 scroll-mt-24">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <WalletIcon />
          </span>
        }
        title="API spending this month"
        description={`${month} (UTC), every project. Resets on the 1st.`}
        actions={<span className="text-xl font-bold tracking-tight tabular-nums">{formatMicros(spend.totalMicros)}</span>}
      />
      {spend.plan.stages > 0 && (
        <div className="flex flex-col gap-1 border-b border-border/70 px-6 py-4">
          <h3 className="eyebrow text-muted-foreground">Plan usage this month</h3>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{spend.plan.stages}</span> stage{spend.plan.stages === 1 ? "" : "s"} on your plans ·{" "}
            <span className="font-semibold tabular-nums">{formatTokens(spend.plan.tokens)}</span> tokens
            {spend.plan.equivalentMicros > 0 && <span className="text-muted-foreground"> (≈ {formatMicros(spend.plan.equivalentMicros)} at API prices, not spent)</span>}
          </p>
        </div>
      )}
      {spend.totalMicros === 0 ? (
        <SurfaceEmpty icon={WalletIcon} title="No spend yet" description="Your agents haven't spent anything this month." />
      ) : (
        <div className="grid gap-8 p-6 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <h3 className="eyebrow text-muted-foreground">By project</h3>
            <BarList
              items={spend.byWorkspace.map((row) => {
                const workspace = byId.get(row.id);
                return {
                  key: String(row.id),
                  name: row.name,
                  label: (
                    <>
                      {workspace && <WorkspaceAvatar icon={workspace.icon} logoSrc={workspace.logoSrc} size="sm" className="size-6 rounded-md [&_svg]:size-3.5" />}
                      <span className="truncate">{row.name}</span>
                    </>
                  ),
                  value: row.micros,
                  display: formatMicros(row.micros),
                };
              })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <h3 className="eyebrow text-muted-foreground">By agent</h3>
            <BarList
              items={spend.byAgent.map((row) => {
                const role = AGENT_ROLES[row.key];
                return {
                  key: row.key,
                  name: role.name,
                  label: (
                    <>
                      <AgentAvatar agent={role} alt="" className="size-6" />
                      <span className="truncate">{role.name}</span>
                    </>
                  ),
                  value: row.micros,
                  display: formatMicros(row.micros),
                };
              })}
            />
          </div>
        </div>
      )}
    </section>
  );
}
