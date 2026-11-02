"use client";

import Link from "next/link";
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon, PlusIcon } from "lucide-react";

import { dashboardHref } from "@/components/dashboard/nav";
import { useDashboardSection } from "@/components/dashboard/use-dashboard-section";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";

export type SwitcherWorkspace = { id: number; name: string; icon: string; logoSrc: string | null; repo: string };

export function WorkspaceSwitcher({ workspaces, currentId }: { workspaces: SwitcherWorkspace[]; currentId: number }) {
  const { isMobile } = useSidebar();
  // Switching keeps you in the same section (Board → other workspace's Board).
  const section = useDashboardSection();
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0]!;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={current.name}
                className="rounded-xl border border-sidebar-border bg-card hover:border-sidebar-primary/30 hover:bg-card data-popup-open:border-sidebar-primary/30 data-popup-open:bg-card group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent"
              />
            }
          >
            <WorkspaceAvatar icon={current.icon} logoSrc={current.logoSrc} size="sm" />
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-bold">{current.name}</span>
              <span className="truncate text-xs text-muted-foreground">{current.repo}</span>
            </span>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={8}
            className="w-(--anchor-width) min-w-64"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="eyebrow text-muted-foreground">Workspaces</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  render={<Link href={dashboardHref(workspace.id, section.segment)} />}
                  className="gap-2 py-1.5"
                >
                  <WorkspaceAvatar
                    icon={workspace.icon}
                    logoSrc={workspace.logoSrc}
                    size="sm"
                    className="size-6 rounded-md [&_svg]:size-3.5"
                  />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === current.id && <CheckIcon className="ml-auto text-brand-emphasis" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/workspaces/new" />} className="gap-2 py-1.5">
              <span className="flex size-6 items-center justify-center rounded-md border bg-background">
                <PlusIcon className="size-3.5" />
              </span>
              Create new workspace
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/workspaces" />} className="gap-2 py-1.5 text-muted-foreground">
              <span className="flex size-6 items-center justify-center">
                <LayoutGridIcon className="size-3.5" />
              </span>
              All workspaces
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
