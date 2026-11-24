import type { Metadata } from "next";

import { OverviewView } from "@/components/dashboard/overview-view";
import { getOverviewData } from "@/lib/overview";
import { getSetupStatus } from "@/lib/setup";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ params }: PageProps<"/dashboard/[workspaceId]">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  const [data, setup] = await Promise.all([getOverviewData(workspace, user.id), getSetupStatus(user.id, workspace.id)]);
  return <OverviewView userName={user.name} workspace={workspace} data={data} setup={setup} />;
}
