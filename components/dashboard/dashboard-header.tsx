"use client";

import Link from "next/link";
import { BellIcon, BellOffIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { dashboardHref } from "@/components/dashboard/nav";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Top bar to the right of the sidebar. */
export function DashboardHeader({
  user,
  workspace,
}: {
  user: MenuUser;
  workspace: { id: number; name: string; repo: string; repoUrl: string };
}) {
  const section = useDashboardSection();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger className="-ml-1" />
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
            <BreadcrumbPage className="font-medium">{section.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={workspace.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${workspace.repo} on GitHub`}
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              />
            }
          >
            <GitHubIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{workspace.repo}</TooltipContent>
        </Tooltip>

        <NotificationsMenu />

        <Separator orientation="vertical" className="mx-2 data-vertical:h-5 data-vertical:self-center" />
        <HeaderUserMenu user={user} workspaceId={workspace.id} />
      </div>
    </header>
  );
}

function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Notifications" className={buttonVariants({ variant: "ghost", size: "icon" })}>
        <BellIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm font-semibold text-foreground">Notifications</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* No notification source yet: agent runs and PR reviews will post here. */}
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <BellOffIcon className="size-5" />
          </span>
          <p className="text-sm font-medium">You&apos;re all caught up</p>
          <p className="text-xs text-muted-foreground">Agent runs and pull request reviews will show up here.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
