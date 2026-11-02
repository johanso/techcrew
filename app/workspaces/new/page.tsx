import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import type { GithubStatus, RepoListResult } from "@/components/workspace/github-repo-picker";
import { requireUser } from "@/lib/current-user";
import { GithubError, getGithubAccount, getGithubToken, isGithubConfigured, listLinkableRepos } from "@/lib/github";
import { isStorageConfigured } from "@/lib/storage";
import { hasWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Create workspace" };

const GITHUB_STATUSES: GithubStatus[] = ["connected", "denied", "error", "not-configured"];

async function loadRepos(userId: number): Promise<RepoListResult> {
  try {
    const token = await getGithubToken(userId);
    if (!token) return { error: "Connect your GitHub account to see repositories.", reconnect: true };
    return { repos: await listLinkableRepos(token) };
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) {
      return { error: "Your GitHub connection expired or was revoked.", reconnect: true };
    }
    console.error("[github] list repos failed", error);
    return { error: "We couldn't load your repositories from GitHub. Refresh to try again.", reconnect: true };
  }
}

export default async function NewWorkspacePage({ searchParams }: PageProps<"/workspaces/new">) {
  const user = await requireUser("/workspaces/new");
  const { github: githubParam } = await searchParams;

  const [github, existing] = await Promise.all([getGithubAccount(user.id), hasWorkspaces(user.id)]);
  const githubStatus = GITHUB_STATUSES.find((status) => status === githubParam);

  return (
    <div className="min-h-svh bg-canvas">
      <AppHeader user={user} />
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">
            {existing ? "New workspace" : "Welcome — let's get you set up"}
          </p>
          <h1 className="text-3xl font-semibold">Create a new workspace</h1>
          <p className="text-sm text-muted-foreground">
            A workspace connects your AI agents to one GitHub repository. It takes about a minute.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-xs sm:p-8">
          <CreateWorkspaceForm
            github={github}
            githubConfigured={isGithubConfigured()}
            githubStatus={githubStatus}
            // Not awaited: the repo list streams in behind a skeleton.
            reposPromise={github ? loadRepos(user.id) : null}
            uploadsEnabled={isStorageConfigured()}
            cancelHref={existing ? "/workspaces" : undefined}
          />
        </div>
      </main>
    </div>
  );
}
