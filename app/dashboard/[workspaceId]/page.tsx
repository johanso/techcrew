import type { Metadata } from "next";

import { OverviewView } from "@/components/dashboard/overview-view";
import { getOverviewData } from "@/lib/overview";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ params }: PageProps<"/dashboard/[workspaceId]">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  const data = await getOverviewData(workspace, user.id);
  return <OverviewView userName={user.name} workspace={workspace} data={data} />;
}
