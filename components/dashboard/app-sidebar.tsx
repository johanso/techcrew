"use client";

import Link from "next/link";

import { APP_NAME, BrandMark } from "@/components/brand";
import { DASHBOARD_NAV, dashboardHref } from "@/components/dashboard/nav";
import { useDashboardSection } from "@/components/dashboard/use-dashboard-section";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/dashboard/workspace-switcher";
import {
  Sidebar,
  SidebarContent,
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

export function AppSidebar({ workspaces, currentId }: { workspaces: SwitcherWorkspace[]; currentId: number }) {
  const active = useDashboardSection();
  const { isMobile, setOpenMobile } = useSidebar();
  // On mobile the sidebar is a sheet; close it once the user picks a destination.
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-4 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={APP_NAME}
              render={<Link href={dashboardHref(currentId)} onClick={closeOnMobile} />}
              className="gap-2.5 hover:bg-transparent active:bg-transparent"
            >
              <BrandMark />
              <span className="truncate text-base font-bold tracking-tight">{APP_NAME}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkspaceSwitcher workspaces={workspaces} currentId={currentId} />
      </SidebarHeader>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupLabel className="eyebrow text-muted-foreground/80">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
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
                      // Active item is a card (hairline ring) on the tinted sidebar; its icon takes the brand color
                      // (sidebar-primary: brand in light mode, the brighter action blue in dark mode).
                      className="h-9 gap-3 rounded-lg px-2.5 text-muted-foreground transition-all hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground data-active:bg-card data-active:font-semibold data-active:text-foreground data-active:ring-1 data-active:ring-sidebar-border data-active:hover:bg-card data-active:[&_svg]:text-sidebar-primary"
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

      <SidebarRail />
    </Sidebar>
  );
}
