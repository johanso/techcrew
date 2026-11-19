import { WalletIcon } from "lucide-react";

import { AgentAvatar } from "@/components/dashboard/agent-avatar";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { SurfaceEmpty } from "@/components/dashboard/section-empty";
import { BarList } from "@/components/metrics/bar-list";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { AGENT_ROLES, formatMicros } from "@/lib/agent-config";
import type { AccountSpend } from "@/lib/agents";

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
        title="Spending this month"
        description={`${month} (UTC), every project. Resets on the 1st.`}
        actions={<span className="text-xl font-bold tracking-tight tabular-nums">{formatMicros(spend.totalMicros)}</span>}
      />
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
