import type { Metadata } from "next";
import { format } from "date-fns";
import { BadgeCheckIcon, ExternalLinkIcon } from "lucide-react";

import { DetailGrid, PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { initials } from "@/lib/utils";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/dashboard/[workspaceId]/settings">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Account & workspace" description="Your account and this workspace's configuration." />

      {/* scroll-mt clears the sticky header when opened from the user menu (#account / #workspace). */}
      <section id="account" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <Avatar size="lg" className="size-12">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback className="text-base">{initials(user.name, user.email)}</AvatarFallback>
            </Avatar>
          }
          title={user.name || user.email}
          description={
            user.emailVerified ? (
              <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                <BadgeCheckIcon className="size-3.5 text-success" /> Verified email
              </span>
            ) : (
              <span className="text-xs">Email not verified</span>
            )
          }
          actions={<span className="eyebrow text-muted-foreground">Account</span>}
        />
        <DetailGrid
          items={[
            { label: "Email", value: user.email },
            { label: "Member since", value: format(user.createdAt, "MMMM d, yyyy") },
            { label: "Last sign-in", value: format(user.lastSignInAt, "MMM d, yyyy 'at' h:mm a") },
            { label: "Account ID", value: `#${user.id}` },
          ]}
        />
      </section>

      <section id="workspace" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={<WorkspaceAvatar icon={workspace.icon} logoSrc={workspaceLogoSrc(workspace)} />}
          title={workspace.name}
          description="Each workspace is linked to exactly one repository."
          actions={
            <a
              href={workspace.githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", className: "h-9" })}
            >
              Open repository
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          }
        />
        <DetailGrid
          items={[
            { label: "Repository", value: workspace.githubRepoFullName },
            { label: "Default branch", value: workspace.githubDefaultBranch },
            { label: "Visibility", value: workspace.githubRepoPrivate ? "Private" : "Public" },
            { label: "Created", value: format(workspace.createdAt, "MMMM d, yyyy") },
          ]}
        />
      </section>
    </>
  );
}
