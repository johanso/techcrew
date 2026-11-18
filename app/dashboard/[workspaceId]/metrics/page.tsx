import type { Metadata } from "next";

import { MetricsView } from "@/components/metrics/metrics-view";
import { getWorkspaceMetrics } from "@/lib/metrics";
import { parsePeriod } from "@/lib/run-metrics";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Metrics" };

export default async function MetricsPage({ params, searchParams }: PageProps<"/dashboard/[workspaceId]/metrics">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  const metrics = await getWorkspaceMetrics(workspace, parsePeriod((await searchParams).days));
  return <MetricsView workspaceId={workspace.id} metrics={metrics} />;
}
