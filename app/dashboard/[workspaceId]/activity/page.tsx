import type { Metadata } from "next";
import Link from "next/link";
import { ActivityIcon } from "lucide-react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { dashboardHref } from "@/components/dashboard/nav";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";
import { buttonVariants } from "@/components/ui/button";
import { ACTIVITY_MAX, ACTIVITY_PAGE_SIZE, getActivityFeed } from "@/lib/activity";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Activity" };

/** `?show=` from the "Show older" link: how many events to list, in page-size steps up to the cap. */
function parseShow(value: string | string[] | undefined) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= ACTIVITY_PAGE_SIZE) return ACTIVITY_PAGE_SIZE;
  return Math.min(Math.ceil(n / ACTIVITY_PAGE_SIZE) * ACTIVITY_PAGE_SIZE, ACTIVITY_MAX);
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/dashboard/[workspaceId]/activity">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  const limit = parseShow((await searchParams).show);
  const { items, hasMore } = await getActivityFeed(workspace, { limit, viewerId: user.id });
  const activityHref = dashboardHref(workspace.id, "activity");

  return (
    <>
      <PageHeader eyebrow="History" title="Activity" description="A timeline of everything that happens in this workspace." />
      {items.length === 0 ? (
        <SectionEmpty
          icon={ActivityIcon}
          title="No activity yet"
          description="New cards, agent runs, pull requests and team changes will be logged here as your team starts working."
        >
          <Link href={dashboardHref(workspace.id, "board")} className={buttonVariants({ className: "h-9" })}>
            Open the board
          </Link>
        </SectionEmpty>
      ) : (
        <ActivityTimeline
          items={items}
          olderHref={hasMore && limit < ACTIVITY_MAX ? `${activityHref}?show=${limit + ACTIVITY_PAGE_SIZE}` : null}
        />
      )}
    </>
  );
}
