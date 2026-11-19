import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRightIcon, BadgeCheckIcon, BotIcon, ContainerIcon, ExternalLinkIcon, KeyRoundIcon, LibraryBigIcon, ShieldCheckIcon } from "lucide-react";

import { dashboardHref } from "@/components/dashboard/nav";
import { DetailGrid, PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { AccountSpendCard } from "@/components/settings/account-spend";
import { AgentAutomationForm } from "@/components/settings/agent-automation-form";
import { AutoFailoverToggle } from "@/components/settings/auto-failover-toggle";
import { ProviderKeyForm } from "@/components/settings/provider-key-form";
import { SandboxFormSkeleton, SandboxSettings } from "@/components/settings/sandbox-form";
import { SwitchConnectionForm } from "@/components/settings/switch-connection-form";
import { SwitchWeeklyToggle } from "@/components/settings/switch-weekly-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { PROVIDER_IDS } from "@/lib/agent-config";
import { parseMergeMode } from "@/lib/agent-run-config";
import { getSkillLibrary } from "@/lib/agent-skills";
import { ensureDefaultAgents, getAccountSpend } from "@/lib/agents";
import { getProviderKeyViews } from "@/lib/ai-keys";
import { detectRepoCommands, sandboxAvailable } from "@/lib/sandbox";
import { previewsAvailable } from "@/lib/sandbox/preview";
import { getSwitchConnectionView } from "@/lib/switch-trust";
import { initials } from "@/lib/utils";
import { getDashboardContext, listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/dashboard/[workspaceId]/settings">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  // Agents and built-in skills exist before the library lists who uses what.
  await ensureDefaultAgents(workspace.id);
  const [keys, switchView, skills, spend, owned] = await Promise.all([
    getProviderKeyViews(user.id, workspace.id),
    getSwitchConnectionView(workspace.id),
    getSkillLibrary(workspace.id),
    getAccountSpend(user.id),
    listWorkspaces(user.id),
  ]);
  // Reads package.json on GitHub: streamed in so the rest of the page doesn't wait for it.
  const detectedCommands = detectRepoCommands(workspace).catch(() => null);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Account & workspace"
        description="Your account applies to every project you own; the rest is this workspace's configuration."
      />

      <GroupLabel title="Your account" description="Applies to every project you own." />

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

      <section id="ai" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <KeyRoundIcon />
            </span>
          }
          title="AI providers"
          description="Your keys pay for every project. Each agent picks its company and model on the AI Team page."
          actions={<span className="eyebrow text-muted-foreground">AI</span>}
        />
        <div className="flex flex-col gap-6 p-6">
          {PROVIDER_IDS.map((provider) => (
            <ProviderKeyForm key={provider} workspaceId={workspace.id} provider={provider} scope="account" view={keys[provider]} />
          ))}
        </div>
        {/* Workspace-only settings live here too, so everything about AI companies is in one place. */}
        <div className="flex flex-col gap-6 border-t border-border/70 p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="eyebrow text-muted-foreground">This workspace only</p>
            <p className="truncate text-xs text-muted-foreground">{workspace.name}</p>
          </div>
          <AutoFailoverToggle
            workspaceId={workspace.id}
            enabled={workspace.aiAutoFailover}
            canSwitch={PROVIDER_IDS.filter((provider) => keys[provider].inUse !== null).length >= 2}
          />
          <div className="flex flex-col gap-6 border-t border-border/70 pt-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-bold">Workspace keys (optional)</h3>
              <p className="text-xs text-muted-foreground">
                Only used for a company your account has no key for. Your account&apos;s key always wins.
              </p>
            </div>
            {PROVIDER_IDS.map((provider) => (
              <ProviderKeyForm key={provider} workspaceId={workspace.id} provider={provider} scope="workspace" view={keys[provider]} />
            ))}
          </div>
        </div>
      </section>

      <AccountSpendCard spend={spend} workspaces={owned.map((w) => ({ id: w.id, icon: w.icon, logoSrc: workspaceLogoSrc(w) }))} />

      <GroupLabel title="This workspace" description={`${workspace.name} · ${workspace.githubRepoFullName}`} />

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

      <section id="sandbox" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <ContainerIcon />
            </span>
          }
          title="Sandbox"
          description="Agents with “Run tests in a sandbox” install, test and build your repository in an isolated container before review."
          actions={<span className="eyebrow text-muted-foreground">Execution</span>}
        />
        <Suspense fallback={<SandboxFormSkeleton />}>
          <SandboxSettings
            workspaceId={workspace.id}
            available={sandboxAvailable()}
            enabled={workspace.sandboxEnabled}
            saved={workspace.sandboxCommands}
            previewsAvailable={previewsAvailable()}
            previewEnabled={workspace.sandboxPreview}
            detected={detectedCommands}
          />
        </Suspense>
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

      {/* The library has its own page (it can grow to many skills); #skills stays as an anchor for old links. */}
      <section id="skills" className="surface scroll-mt-24">
        <SurfaceHeader
          icon={
            <span className="icon-tile text-brand-emphasis">
              <LibraryBigIcon />
            </span>
          }
          title="Agent skills"
          description={`Knowledge your agents search and read while they work. ${skills.length} installed, ${skills.filter((s) => s.source === "uploaded").length} uploaded.`}
          actions={
            <Link href={dashboardHref(workspace.id, "settings/skills")} className={buttonVariants({ variant: "outline", className: "h-9" })}>
              Manage skills
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          }
        />
      </section>
    </>
  );
}

/** Splits Settings into what applies to every project and what belongs to this one. */
function GroupLabel({ title, description }: { title: string; description: string }) {
  return (
    <div className="-mb-4 flex min-w-0 flex-col gap-1 pt-2">
      <p className="eyebrow text-brand-emphasis">{title}</p>
      <p className="truncate text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
