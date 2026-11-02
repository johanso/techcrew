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
}: {
  user: MenuUser;
  workspace: { id: number; name: string; repo: string; repoUrl: string };
}) {
  const section = useDashboardSection();

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
                className={ACTION_BUTTON}
              />
            }
          >
            <GitHubIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{workspace.repo}</TooltipContent>
        </Tooltip>

        <NotificationsMenu />

        <Separator orientation="vertical" className="mx-1 data-vertical:h-6 data-vertical:self-center" />
        <HeaderUserMenu user={user} workspaceId={workspace.id} />
      </div>
    </header>
  );
}

function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Notifications" className={ACTION_BUTTON}>
        <BellIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm font-semibold text-foreground">Notifications</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* No notification source yet: agent runs and PR reviews will post here. */}
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="icon-tile mb-1 rounded-full text-brand-emphasis">
            <BellOffIcon />
          </span>
          <p className="text-sm font-semibold">You&apos;re all caught up</p>
          <p className="text-xs text-muted-foreground">Agent runs and pull request reviews will show up here.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
