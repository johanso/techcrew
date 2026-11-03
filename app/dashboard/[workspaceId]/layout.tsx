import { cookies } from "next/headers";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { getDashboardContext } from "@/lib/workspaces";

// Written by SidebarProvider (components/ui/sidebar.tsx) whenever the sidebar is toggled.
const SIDEBAR_COOKIE = "sidebar_state";

export default async function WorkspaceDashboardLayout({ children, params }: LayoutProps<"/dashboard/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, workspace, workspaces } = await getDashboardContext(workspaceId);
  // Render the sidebar in its last state (expanded or icon-only) without a flash.
  const defaultOpen = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "false";

  const menuUser = { name: user.name, email: user.email, image: user.image };

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          user={menuUser}
          currentId={workspace.id}
          workspaces={workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            icon: w.icon,
            logoSrc: workspaceLogoSrc(w),
            repo: w.githubRepoFullName,
          }))}
        />
        {/*
          Inset variant: content floats as a rounded panel with its own scroll, so the header sticks inside it.
          min-w-0: as a flex item it would otherwise grow to fit wide content (the board) on mobile.
        */}
        <SidebarInset className="min-w-0 bg-canvas md:h-[calc(100svh-1rem)] md:overflow-y-auto md:border md:border-sidebar-border">
          <DashboardHeader
            user={menuUser}
            workspace={{
              id: workspace.id,
              name: workspace.name,
              repo: workspace.githubRepoFullName,
              repoUrl: workspace.githubRepoUrl,
            }}
          />
          {/* Pages render inside a max-w-6xl column; a page marked data-page-width="full" (the board) opts out. */}
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-8 has-data-[page-width=full]:max-w-none lg:px-10">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
