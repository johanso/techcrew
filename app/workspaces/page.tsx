import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ChevronRightIcon, LockIcon, PlusIcon } from "lucide-react";

import { GitHubIcon } from "@/components/auth/brand-icons";
import { AppHeader } from "@/components/app-header";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceAvatar, workspaceLogoSrc } from "@/components/workspace/workspace-avatar";
import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

/** Landing page after sign-in: pick a workspace, or create the first one. */
export default async function WorkspacesPage() {
  const user = await requireUser("/workspaces");
  const workspaces = await listWorkspaces(user.id);
  if (workspaces.length === 0) redirect("/workspaces/new");

  return (
    <div className="min-h-svh bg-lightest">
      <AppHeader user={user} />
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-semibold">Your workspaces</h1>
            <p className="text-sm text-muted-foreground">Choose a workspace to open its dashboard.</p>
          </div>
          <Link href="/workspaces/new" className={buttonVariants({ className: "h-10 px-4" })}>
            <PlusIcon />
            New workspace
          </Link>
        </div>

        <ul className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="border-b last:border-b-0">
              <Link
                href={`/dashboard?workspace=${workspace.id}`}
                className="group flex items-center gap-4 p-4 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 sm:p-5"
              >
                <WorkspaceAvatar icon={workspace.icon} logoSrc={workspaceLogoSrc(workspace)} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate font-semibold">{workspace.name}</p>
                  <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                    <GitHubIcon className="size-3.5 shrink-0" />
                    {workspace.githubRepoFullName}
                    {workspace.githubRepoPrivate && <LockIcon className="size-3 shrink-0" aria-label="Private" />}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Created {formatDistanceToNow(workspace.createdAt, { addSuffix: true })}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
