import type { Metadata } from "next";

import { OverviewView } from "@/components/dashboard/overview-view";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ params }: PageProps<"/dashboard/[workspaceId]">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  return <OverviewView userName={user.name} workspace={workspace} />;
}
