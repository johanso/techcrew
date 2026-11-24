import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowRightIcon, BotIcon, ContainerIcon, ExternalLinkIcon, KeyRoundIcon, LibraryBigIcon, LogOutIcon } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { dashboardHref } from "@/components/dashboard/nav";
import { DetailGrid, PageHeader, SurfaceHeader } from "@/components/dashboard/page-header";
import { AccountSpendCard } from "@/components/settings/account-spend";
import { AgentAutomationForm } from "@/components/settings/agent-automation-form";
import { AutoFailoverToggle } from "@/components/settings/auto-failover-toggle";
import { ClaudePlanSettings } from "@/components/settings/cli-plan-settings";
import { FallbackOrder } from "@/components/settings/fallback-order";
import { ModelCatalogStatus } from "@/components/settings/model-catalog-status";
import { ProviderKeyForm } from "@/components/settings/provider-key-form";
import { SandboxFormSkeleton } from "@/components/settings/sandbox-form";
import { SandboxSection } from "@/components/settings/sandbox-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { PROVIDER_IDS, effectiveFallbackOrder, normalizeFallbackOrder } from "@/lib/agent-config";
import { parseMergeMode } from "@/lib/agent-run-config";
import { getSkillLibrary } from "@/lib/agent-skills";
import { ensureDefaultAgents, getAccountSpend } from "@/lib/agents";
import { getProviderKeyViews } from "@/lib/ai-keys";
import { getClaudePlanView } from "@/lib/cli/plan-view";
import { getGithubAccount } from "@/lib/github";
import { getModelCatalog, refreshModelCatalogIfStale } from "@/lib/model-catalog";
import { cn, initials } from "@/lib/utils";
import { getDashboardContext, listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/dashboard/[workspaceId]/settings">) {
  const { user, workspace } = await getDashboardContext((await params).workspaceId);
  // Agents and built-in skills exist before the library lists who uses what.
  await ensureDefaultAgents(workspace.id);
  const [keys, skills, spend, owned, catalog, github] = await Promise.all([
    getProviderKeyViews(user.id),
    getSkillLibrary(workspace.id),
    getAccountSpend(user.id),
    listWorkspaces(user.id),
    getModelCatalog(),
    getGithubAccount(user.id),
  ]);
  // A model list older than a day is fetched again after the response.
  after(refreshModelCatalogIfStale);
  // Null on a deploy (or AGENTS_LOCAL_CLI=false): nothing about local CLIs shows.
  const plan = await getClaudePlanView(user.id, workspace.id);
  // Configured providers first; the others wait under "Add another provider".
  const configured = PROVIDER_IDS.filter((provider) => keys[provider].account !== null);
  const others = PROVIDER_IDS.filter((provider) => keys[provider].account === null);
  const avatar = github?.avatarUrl ?? user.image;

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
              {avatar && <AvatarImage src={avatar} alt="" />}
              <AvatarFallback className="text-base">{initials(user.name, github?.login ?? user.email)}</AvatarFallback>
            </Avatar>
          }
          title={user.name || github?.login || "Your account"}
          description={github ? `@${github.login} · Signed in with GitHub` : "GitHub not connected"}
          actions={
            <form action={signOut}>
              <Button type="submit" variant="outline" className="h-9">
                <LogOutIcon data-icon="inline-start" />
                Sign out
              </Button>
            </form>
          }
        />
        {!github && (
          <p className="border-b border-border/70 px-6 py-4 text-xs text-muted-foreground">
            <Link href="/sign-in" className="font-medium text-brand-emphasis hover:underline">
              Sign in with GitHub
            </Link>{" "}
            to connect your repositories.
          </p>
        )}
        <DetailGrid
          items={[
            { label: "Member since", value: format(user.createdAt, "MMMM d, yyyy") },
            { label: "Last sign-in", value: format(user.lastSignInAt, "MMM d, yyyy 'at' h:mm a") },
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
          title="AI"
          description={
            plan
              ? "Your plans on this computer and your API keys. Each agent picks its company and model on the AI Team page."
              : "Your keys pay for every project. Each agent picks its company and model on the AI Team page."
          }
          actions={<span className="eyebrow text-muted-foreground">AI</span>}
        />
        {plan && (
          <div className="flex flex-col gap-4 p-6">
            <SubgroupHeading
              title="Plans on this computer"
              description="Agents on Claude models can run on your Claude plan through Claude Code installed here, instead of an API key."
            />
            <ClaudePlanSettings workspaceId={workspace.id} initial={plan} />
          </div>
        )}
        <div className={cn("flex flex-col gap-6 p-6", plan && "border-t border-border/70")}>
          {plan && <SubgroupHeading title="API keys" description="Your keys pay for every project, and for any stage your plan doesn't carry." />}
          {configured.map((provider) => (
            <ProviderKeyForm key={provider} workspaceId={workspace.id} provider={provider} view={keys[provider]} />
          ))}
          {configured.length > 0 && others.length > 0 && <p className="eyebrow -mb-2 text-muted-foreground">Add another provider</p>}
          {others.map((provider) => (
            <ProviderKeyForm key={provider} workspaceId={workspace.id} provider={provider} view={keys[provider]} />
          ))}
        </div>
        <div className="border-t border-border/70 p-6">
          <ModelCatalogStatus
            workspaceId={workspace.id}
            updated={catalog.fetchedAt ? formatDistanceToNowStrict(new Date(catalog.fetchedAt), { addSuffix: true }) : null}
            current={catalog.models.filter((m) => m.current).length}
          />
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
          {PROVIDER_IDS.filter((provider) => keys[provider].inUse !== null).length >= 2 && (
            <FallbackOrder
              workspaceId={workspace.id}
              order={effectiveFallbackOrder(normalizeFallbackOrder(workspace.aiFallbackOrder))}
              hasKey={{
                openai: keys.openai.inUse !== null,
                anthropic: keys.anthropic.inUse !== null,
                openrouter: keys.openrouter.inUse !== null,
              }}
            />
          )}
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
        {/* Asks Docker whether the sandbox can run (a call that may take seconds): streamed, the page never waits for it. */}
        <Suspense fallback={<SandboxFormSkeleton />}>
          <SandboxSection workspace={workspace} />
        </Suspense>
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

/** A group inside a settings card (AI: plans on this computer, then API keys). */
function SubgroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
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
