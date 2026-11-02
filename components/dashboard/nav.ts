import {
  ActivityIcon,
  BotIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SquareKanbanIcon,
  type LucideIcon,
} from "lucide-react";

export type DashboardSection = { segment: string; label: string; icon: LucideIcon };

/** Sidebar menu, in order. `segment` is the path under /dashboard/[workspaceId]. */
export const DASHBOARD_NAV: DashboardSection[] = [
  { segment: "", label: "Overview", icon: LayoutDashboardIcon },
  { segment: "board", label: "Board", icon: SquareKanbanIcon },
  { segment: "ai-team", label: "AI Team", icon: BotIcon },
  { segment: "pull-requests", label: "Pull Requests", icon: GitPullRequestIcon },
  { segment: "activity", label: "Activity", icon: ActivityIcon },
];

export const SETTINGS_SECTION: DashboardSection = { segment: "settings", label: "Settings", icon: SettingsIcon };

export function dashboardHref(workspaceId: number, segment = "") {
  return segment ? `/dashboard/${workspaceId}/${segment}` : `/dashboard/${workspaceId}`;
}
