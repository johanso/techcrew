import { CircleDotDashedIcon, GitPullRequestArrowIcon, ListTodoIcon } from "lucide-react";

import { dashboardHref } from "@/components/dashboard/nav";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TeamStatus } from "@/components/dashboard/team-status";
import { UpcomingTasks } from "@/components/dashboard/upcoming-tasks";
import { LiveTeamProvider } from "@/components/ai-team/live-team";
import type { OverviewData } from "@/lib/overview";

/** Overview content. Presentational: the page loads the data. */
export function OverviewView({
  userName,
  workspace,
  data,
}: {
  userName: string | null;
  workspace: { id: number; name: string };
  data: OverviewData;
}) {
  const { stats } = data;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="eyebrow text-brand-emphasis">Overview</p>
        <h1 className="text-2xl font-bold sm:text-3xl">
          Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening in {workspace.name} today.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Task summary">
        <StatTile icon={ListTodoIcon} label="Open tasks" value={stats.open.count} hint={stats.open.hint} tone="text-brand-emphasis" />
        <StatTile
          icon={CircleDotDashedIcon}
          label="In progress"
          value={stats.inProgress.count}
          hint={stats.inProgress.hint}
          tone="text-warning"
        />
        <StatTile
          icon={GitPullRequestArrowIcon}
          label="PR ready"
          value={stats.prReady.count}
          hint={stats.prReady.hint}
          tone="text-success"
        />
      </section>

      {/* Keeps the AI team card's statuses live. */}
      <LiveTeamProvider workspaceId={workspace.id} initial={data.team}>
        <div className="grid gap-4 lg:grid-cols-5">
          <UpcomingTasks
            tasks={data.upcomingTasks}
            boardHref={dashboardHref(workspace.id, "board")}
            className="lg:col-span-3"
          />
          <TeamStatus teamHref={dashboardHref(workspace.id, "ai-team")} className="lg:col-span-2" />
        </div>
      </LiveTeamProvider>

      <RecentActivity items={data.recentActivity} activityHref={dashboardHref(workspace.id, "activity")} />
    </>
  );
}
