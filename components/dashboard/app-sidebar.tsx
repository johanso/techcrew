"use client";

import Link from "next/link";

import { APP_NAME, BrandMark } from "@/components/brand";
import { DASHBOARD_NAV, dashboardHref } from "@/components/dashboard/nav";
import { useDashboardSection } from "@/components/dashboard/use-dashboard-section";
import { SidebarUserMenu, type MenuUser } from "@/components/dashboard/user-menu";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/dashboard/workspace-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebar({
  user,
  workspaces,
  currentId,
}: {
  user: MenuUser;
  workspaces: SwitcherWorkspace[];
  currentId: number;
}) {
  const active = useDashboardSection();
  const { isMobile, setOpenMobile } = useSidebar();
  // On mobile the sidebar is a sheet; close it once the user picks a destination.
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={APP_NAME}
              render={<Link href={dashboardHref(currentId)} onClick={closeOnMobile} />}
              className="hover:bg-transparent active:bg-transparent"
            >
              <BrandMark />
              <span className="truncate text-base font-semibold tracking-tight">{APP_NAME}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkspaceSwitcher workspaces={workspaces} currentId={currentId} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {DASHBOARD_NAV.map(({ segment, label, icon: Icon }) => {
                const isActive = active.segment === segment;
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={label}
                      render={
                        <Link
                          href={dashboardHref(currentId, segment)}
                          aria-current={isActive ? "page" : undefined}
                          onClick={closeOnMobile}
                        />
                      }
                      // sidebar-primary is brand in light mode and the brighter action blue in dark mode.
                      className="data-active:bg-sidebar-primary/12 data-active:text-sidebar-primary data-active:hover:bg-sidebar-primary/18"
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu user={user} workspaceId={currentId} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
