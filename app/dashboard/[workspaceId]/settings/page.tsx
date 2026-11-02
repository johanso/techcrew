import type { Metadata } from "next";
import { format } from "date-fns";
import { BadgeCheckIcon, ExternalLinkIcon } from "lucide-react";

import { DetailGrid, PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader title="Settings" description="Your account and this workspace's configuration." />

      {/* scroll-mt clears the sticky header when opened from the user menu (#account / #workspace). */}
      <section id="account" className="scroll-mt-20 rounded-xl border bg-card shadow-xs">
        <div className="flex items-center gap-4 border-b p-6">
          <Avatar size="lg" className="size-14">
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback className="text-base">{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="truncate text-base font-semibold">Account · {user.name || user.email}</h2>
            {user.emailVerified ? (
              <span className="flex items-center gap-1 text-xs font-medium">
                <BadgeCheckIcon className="size-3.5 text-success" /> Verified email
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Email not verified</span>
            )}
          </div>
        </div>
        <DetailGrid
          items={[
            { label: "Email", value: user.email },
            { label: "Member since", value: format(user.createdAt, "MMMM d, yyyy") },
            { label: "Last sign-in", value: format(user.lastSignInAt, "MMM d, yyyy 'at' h:mm a") },
            { label: "Account ID", value: `#${user.id}` },
          ]}
        />
      </section>

      <section id="workspace" className="scroll-mt-20 rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-4 border-b p-6">
          <WorkspaceAvatar icon={workspace.icon} logoSrc={workspaceLogoSrc(workspace)} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="truncate text-base font-semibold">Workspace · {workspace.name}</h2>
            <p className="text-sm text-muted-foreground">Each workspace is linked to exactly one repository.</p>
          </div>
          <a
            href={workspace.githubRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", className: "h-9" })}
          >
            Open repository
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </div>
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
