import type { Metadata } from "next";
import { format } from "date-fns";
import { BadgeCheckIcon, BotIcon, ExternalLinkIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";

import { DetailGrid, PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { AgentAutomationForm } from "@/components/settings/agent-automation-form";
import { AutoFailoverToggle } from "@/components/settings/auto-failover-toggle";
import { ProviderKeyForm } from "@/components/settings/provider-key-form";
import { ProviderSwitchForm } from "@/components/settings/provider-switch-form";
import { SwitchConnectionForm } from "@/components/settings/switch-connection-form";
import { SwitchWeeklyToggle } from "@/components/settings/switch-weekly-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { workspaceProvider } from "@/lib/agent-config";
import { parseMergeMode } from "@/lib/agent-run-config";
import { getProviderKeyViews } from "@/lib/ai-keys";
import { getSwitchConnectionView } from "@/lib/switch-trust";
import { initials } from "@/lib/utils";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/dashboard/[workspaceId]/settings">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  const [keys, switchView] = await Promise.all([getProviderKeyViews(workspace.id), getSwitchConnectionView(workspace.id)]);
  const provider = workspaceProvider(workspace);

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

      <section id="ai" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <KeyRoundIcon />
            </span>
          }
          title="AI providers"
          description="The models your agents run on and the API keys that pay for them. Keys are encrypted and never shown again."
          actions={<span className="eyebrow text-muted-foreground">AI</span>}
        />
        <div className="flex flex-col gap-6 border-t border-border/70 p-6">
          <ProviderSwitchForm
            workspaceId={workspace.id}
            provider={provider}
            connected={{ openai: keys.openai.source !== null, anthropic: keys.anthropic.source !== null }}
          />
          <div className="border-t border-border/70 pt-6">
            <AutoFailoverToggle
              workspaceId={workspace.id}
              enabled={workspace.aiAutoFailover}
              bothConnected={keys.openai.source !== null && keys.anthropic.source !== null}
            />
          </div>
          <div className="flex flex-col gap-6 border-t border-border/70 pt-6">
            <ProviderKeyForm workspaceId={workspace.id} provider="openai" view={keys.openai} />
            <ProviderKeyForm workspaceId={workspace.id} provider="anthropic" view={keys.anthropic} />
          </div>
        </div>
      </section>

      <section id="switch" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <ShieldCheckIcon />
            </span>
          }
          title="Switch Trust"
          description="Connect your Switch account: your agents are registered there and SwitchAgent scans score them with one evaluation each."
          actions={<span className="eyebrow text-muted-foreground">Trust</span>}
        />
        <div className="flex flex-col gap-6 border-t border-border/70 p-6">
          <SwitchConnectionForm workspaceId={workspace.id} view={switchView} />
          {switchView.connected && (
            <div className="border-t border-border/70 pt-6">
              <SwitchWeeklyToggle workspaceId={workspace.id} enabled={switchView.weeklyScans} />
            </div>
          )}
        </div>
      </section>

      <section id="agents" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <BotIcon />
            </span>
          }
          title="Agent automation"
          description="How cards reach your AI team and what happens when their pull requests are ready."
          actions={<span className="eyebrow text-muted-foreground">Agents</span>}
        />
        <AgentAutomationForm workspaceId={workspace.id} autoPickup={workspace.agentAutoPickup} mergeMode={parseMergeMode(workspace.agentMergeMode)} />
      </section>
    </>
  );
}
