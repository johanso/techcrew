import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRightIcon, ExternalLinkIcon, GitBranchIcon, GlobeIcon, LockIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { DASHBOARD_NAV, dashboardHref } from "@/components/dashboard/nav";
import { DetailGrid } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Overview" };

const NEXT_STEPS: Record<string, string> = {
  "ai-team": "Add the agents that will work on this repository and decide what each one owns.",
  board: "Plan work as tasks. Agents pick them up and turn them into branches.",
  "pull-requests": "Review and merge the pull requests your agents open.",
};

export default async function OverviewPage({ params }: PageProps<"/dashboard/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, workspace } = await getDashboardContext(workspaceId);
  const steps = DASHBOARD_NAV.filter((section) => section.segment in NEXT_STEPS);

  return (
    <>
      <div className="flex items-center gap-4">
        <WorkspaceAvatar icon={workspace.icon} logoSrc={workspaceLogoSrc(workspace)} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-3xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-muted-foreground">
            Welcome{user.name ? `, ${user.name.split(" ")[0]}` : ""}. Agents in this workspace work on{" "}
            <span className="font-medium text-foreground">{workspace.githubRepoFullName}</span>.
          </p>
        </div>
      </div>

      <section className="rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-4 border-b p-6">
          <span className="flex size-10 items-center justify-center rounded-lg bg-darkest text-lightest">
            <GitHubIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-base font-semibold">Linked repository</h2>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              {workspace.githubRepoPrivate ? <LockIcon className="size-3.5" /> : <GlobeIcon className="size-3.5" />}
              {workspace.githubRepoFullName}
              <GitBranchIcon className="ml-2 size-3.5" />
              {workspace.githubDefaultBranch}
            </p>
          </div>
          <a
            href={workspace.githubRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", className: "h-9" })}
          >
            Open on GitHub
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </div>
        <DetailGrid
          items={[
            { label: "Default branch", value: workspace.githubDefaultBranch },
            { label: "Linked on", value: format(workspace.createdAt, "MMMM d, yyyy") },
          ]}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Get started</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ segment, label, icon: Icon }) => (
            <Link
              key={segment}
              href={dashboardHref(workspace.id, segment)}
              className="group flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs transition-colors outline-none hover:border-brand/40 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Icon className="size-4.5" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-1 font-semibold">
                  {label}
                  <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm text-muted-foreground">{NEXT_STEPS[segment]}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
