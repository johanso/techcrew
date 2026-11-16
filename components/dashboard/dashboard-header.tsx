"use client";

import Link from "next/link";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { dashboardHref } from "@/components/dashboard/nav";
import { NotificationsMenu } from "@/components/dashboard/notifications-menu";
import { useDashboardSection } from "@/components/dashboard/use-dashboard-section";
import { HeaderUserMenu, type MenuUser } from "@/components/dashboard/user-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationList } from "@/lib/notifications";
import { cn } from "@/lib/utils";

// Round, bordered icon buttons on the right of the header.
const ACTION_BUTTON = buttonVariants({
  variant: "ghost",
  size: "icon",
  className:
    "size-9 rounded-full border bg-card text-muted-foreground hover:border-brand/30 hover:bg-card hover:text-foreground aria-expanded:bg-card data-popup-open:border-brand/30 data-popup-open:text-foreground",
});

/** Top bar to the right of the sidebar. */
export function DashboardHeader({
  user,
  workspace,
  notifications,
}: {
  user: MenuUser;
  workspace: { id: number; name: string; repo: string; repoUrl: string };
  notifications: NotificationList;
}) {
  const section = useDashboardSection();
  // The project's name, without its owner (the tooltip has the full owner/repo).
  const repoName = workspace.repo.split("/").pop();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-canvas/80 px-4 backdrop-blur-md lg:px-6">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />

      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden min-w-0 md:flex">
            <BreadcrumbLink render={<Link href={dashboardHref(workspace.id)} />} className="truncate">
              {workspace.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:flex" />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold">{section.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={workspace.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${workspace.repo} on GitHub`}
                // A pill with the repository name from sm up; the round icon button on phones.
                className={cn(ACTION_BUTTON, "sm:w-auto sm:max-w-64 sm:gap-2 sm:px-3")}
              />
            }
          >
            <GitHubIcon className="size-4 shrink-0" />
            <span className="hidden min-w-0 truncate text-sm font-semibold text-foreground sm:inline">{repoName}</span>
          </TooltipTrigger>
          <TooltipContent>Open {workspace.repo} on GitHub</TooltipContent>
        </Tooltip>

        <NotificationsMenu workspaceId={workspace.id} initial={notifications} className={ACTION_BUTTON} />

        <Separator orientation="vertical" className="mx-1 data-vertical:h-6 data-vertical:self-center" />
        <HeaderUserMenu user={user} workspaceId={workspace.id} />
      </div>
    </header>
  );
}
