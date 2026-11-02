import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  CalendarDaysIcon,
  GitBranchIcon,
  GlobeIcon,
  LockIcon,
} from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { DASHBOARD_NAV, dashboardHref } from "@/components/dashboard/nav";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import type { Workspace } from "@/db";
import { cn } from "@/lib/utils";

const NEXT_STEPS: Record<string, { body: string; tone: string }> = {
  "ai-team": { body: "Add the agents that will work on this repository and decide what each one owns.", tone: "text-brand-emphasis" },
  board: { body: "Plan work as tasks. Agents pick them up and turn them into branches.", tone: "text-action" },
  "pull-requests": { body: "Review and merge the pull requests your agents open.", tone: "text-success" },
};

export type OverviewWorkspace = Pick<
  Workspace,
  "id" | "name" | "icon" | "logoKey" | "githubRepoFullName" | "githubRepoUrl" | "githubDefaultBranch" | "githubRepoPrivate" | "createdAt"
>;

/** Overview content. Presentational: the page loads the data. */
export function OverviewView({ userName, workspace }: { userName: string | null; workspace: OverviewWorkspace }) {
  const steps = DASHBOARD_NAV.filter((section) => section.segment in NEXT_STEPS);
  const [owner, repoName] = workspace.githubRepoFullName.split("/");

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="eyebrow text-brand-emphasis">Overview</p>
        <h1 className="text-2xl font-bold sm:text-3xl">
          Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s set up in {workspace.name}.</p>
      </div>

      {/* Hero: the repository this workspace's agents work on. */}
      <section className="surface-brand p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 -z-10 size-72 rounded-full border border-white/15" />
        <div aria-hidden className="pointer-events-none absolute -top-10 right-10 -z-10 size-44 rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-6 -bottom-28 -z-10 size-64 rounded-full bg-white/5" />

        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex items-center gap-3">
              <WorkspaceAvatar
                icon={workspace.icon}
                logoSrc={workspaceLogoSrc(workspace)}
                className="bg-white/15 ring-1 ring-white/25 backdrop-blur-sm"
              />
              <div className="flex min-w-0 flex-col">
                <span className="eyebrow text-white/70">Linked repository</span>
                <span className="truncate text-sm font-semibold text-white/90">{workspace.name}</span>
              </div>
            </div>
            <h2 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="font-medium text-white/65">{owner}/</span>
              {repoName}
            </h2>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <HeroChip>
                {workspace.githubRepoPrivate ? <LockIcon /> : <GlobeIcon />}
                {workspace.githubRepoPrivate ? "Private" : "Public"}
              </HeroChip>
              <HeroChip>
                <GitBranchIcon />
                {workspace.githubDefaultBranch}
              </HeroChip>
            </div>
          </div>
          <a
            href={workspace.githubRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-lg bg-white px-4 text-sm font-semibold text-brand transition-colors hover:bg-white/90 sm:self-auto"
          >
            <GitHubIcon className="size-4" />
            Open on GitHub
            <ArrowUpRightIcon className="size-4" />
          </a>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace at a glance">
        <StatTile icon={GitBranchIcon} label="Default branch" value={workspace.githubDefaultBranch} tone="text-brand-emphasis" />
        <StatTile
          icon={workspace.githubRepoPrivate ? LockIcon : GlobeIcon}
          label="Visibility"
          value={workspace.githubRepoPrivate ? "Private" : "Public"}
          tone="text-action"
        />
        <StatTile icon={BotIcon} label="AI agents" value="0" hint="Add your first agent" tone="text-success" />
        <StatTile
          icon={CalendarDaysIcon}
          label="Linked on"
          value={format(workspace.createdAt, "MMM d, yyyy")}
          tone="text-warning"
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Get started</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ segment, label, icon: Icon }) => (
            <Link
              key={segment}
              href={dashboardHref(workspace.id, segment)}
              className="surface surface-interactive group flex flex-col gap-4 p-5"
            >
              <span className={cn("icon-tile", NEXT_STEPS[segment]!.tone)}>
                <Icon />
              </span>
              <span className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 font-bold">
                  {label}
                  <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-emphasis" />
                </span>
                <span className="text-sm text-muted-foreground">{NEXT_STEPS[segment]!.body}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function HeroChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20 backdrop-blur-sm [&_svg]:size-3.5">
      {children}
    </span>
  );
}
