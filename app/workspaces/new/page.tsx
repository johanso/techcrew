import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import type { RepoListResult } from "@/components/workspace/github-repo-picker";
import { requireUser } from "@/lib/current-user";
import { GithubError, getGithubAccount, getGithubToken, listLinkableRepos } from "@/lib/github";
import { hasWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Create workspace" };

async function loadRepos(userId: number): Promise<RepoListResult> {
  try {
    const token = await getGithubToken(userId);
    if (!token) return { error: "Sign in with GitHub to see repositories.", reconnect: true };
    return { repos: await listLinkableRepos(token) };
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) {
      return { error: "Your GitHub connection expired or was revoked.", reconnect: true };
    }
    console.error("[github] list repos failed", error);
    return { error: "We couldn't load your repositories from GitHub. Refresh to try again.", reconnect: true };
  }
}

export default async function NewWorkspacePage() {
  const user = await requireUser("/workspaces/new");

  const [github, existing] = await Promise.all([getGithubAccount(user.id), hasWorkspaces(user.id)]);

  return (
    <div className="min-h-svh bg-canvas">
      <AppHeader user={user} />
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-col gap-1">
          <p className="eyebrow text-brand-emphasis">
            {existing ? "New workspace" : "Welcome — let's get you set up"}
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">Create a new workspace</h1>
          <p className="text-sm text-muted-foreground">
            A workspace connects your AI agents to one GitHub repository. It takes about a minute.
          </p>
        </div>

        <div className="surface p-6 sm:p-8">
          <CreateWorkspaceForm
            github={github}
            // Not awaited: the repo list streams in behind a skeleton.
            reposPromise={github ? loadRepos(user.id) : null}
            cancelHref={existing ? "/workspaces" : undefined}
          />
        </div>
      </main>
    </div>
  );
}
