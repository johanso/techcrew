import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { BadgeCheckIcon, ChevronsUpDownIcon, ExternalLinkIcon, GitBranchIcon, LockIcon, GlobeIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { AppHeader } from "@/components/app-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { requireUser } from "@/lib/current-user";
import { initials } from "@/lib/utils";
import { listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const workspaces = await listWorkspaces(user.id);
  if (workspaces.length === 0) redirect("/workspaces/new");

  const { workspace: workspaceParam } = await searchParams;
  // Unknown or foreign ids fall back to the newest workspace: the list only holds the user's own.
  const workspace = workspaces.find((w) => String(w.id) === workspaceParam) ?? workspaces[0]!;
  const logoSrc = workspaceLogoSrc(workspace);

  const repoDetails = [
    { label: "Repository", value: workspace.githubRepoFullName },
    { label: "Default branch", value: workspace.githubDefaultBranch },
    { label: "Visibility", value: workspace.githubRepoPrivate ? "Private" : "Public" },
    { label: "Linked on", value: format(workspace.createdAt, "MMMM d, yyyy") },
  ];
  const accountDetails = [
    { label: "Email", value: user.email },
    { label: "Member since", value: format(user.createdAt, "MMMM d, yyyy") },
    { label: "Last sign-in", value: format(user.lastSignInAt, "MMM d, yyyy 'at' h:mm a") },
    { label: "Account ID", value: `#${user.id}` },
  ];

  return (
    <div className="min-h-svh bg-lightest">
      <AppHeader user={user}>
        <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />
        <Link
          href="/workspaces"
          className="hidden min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted sm:flex"
        >
          <WorkspaceAvatar icon={workspace.icon} logoSrc={logoSrc} size="sm" className="size-6 rounded-md [&_svg]:size-3.5" />
          <span className="truncate">{workspace.name}</span>
          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
          <span className="sr-only">Switch workspace</span>
        </Link>
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <div className="flex items-center gap-4">
          <WorkspaceAvatar icon={workspace.icon} logoSrc={logoSrc} size="lg" />
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
          <DetailGrid items={repoDetails} />
        </section>

        <section className="rounded-xl border bg-card shadow-xs">
          <div className="flex items-center gap-4 border-b p-6">
            <Avatar size="lg" className="size-14">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback className="text-base">{initials(user.name, user.email)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="truncate text-base font-semibold">{user.name || user.email}</h2>
              {user.emailVerified ? (
                <span className="flex items-center gap-1 text-xs font-medium">
                  <BadgeCheckIcon className="size-3.5 text-success" /> Verified email
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Email not verified</span>
              )}
            </div>
          </div>
          <DetailGrid items={accountDetails} />
        </section>
      </main>
    </div>
  );
}

function DetailGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-b-xl bg-border sm:grid-cols-2">
      {items.map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-1 bg-card p-6">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
          <dd className="truncate text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
