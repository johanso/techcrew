"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/current-user";
import { GithubError, deleteGithubConnection, getGithubToken, getLinkableRepo } from "@/lib/github";
import { LOGO_MAX_BYTES, isAllowedLogoType, uploadWorkspaceLogo } from "@/lib/storage";
import { isWorkspaceIcon } from "@/lib/workspace-icons";
import { insertWorkspace } from "@/lib/workspaces";

const NAME_MAX_LENGTH = 60;
const REPO_FULL_NAME = /^[\w.-]+\/[\w.-]+$/;

export type WorkspaceFormState = {
  message?: string;
  errors?: Partial<Record<"name" | "icon" | "logo" | "repo", string>>;
};

export async function createWorkspace(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  const user = await requireUser("/workspaces/new");

  const name = String(formData.get("name") ?? "").trim();
  const icon = formData.get("icon");
  const repoFullName = String(formData.get("repo") ?? "");
  const logo = formData.get("logo");
  const logoFile = logo instanceof File && logo.size > 0 ? logo : null;

  const errors: WorkspaceFormState["errors"] = {};
  if (!name) errors.name = "Give your workspace a name.";
  else if (name.length > NAME_MAX_LENGTH) errors.name = `Keep the name under ${NAME_MAX_LENGTH} characters.`;
  if (!isWorkspaceIcon(icon)) errors.icon = "Choose an icon.";
  if (logoFile && !isAllowedLogoType(logoFile.type)) errors.logo = "Upload a PNG, JPG, WebP or GIF image.";
  else if (logoFile && logoFile.size > LOGO_MAX_BYTES) errors.logo = "The logo must be 1 MB or smaller.";
  if (!REPO_FULL_NAME.test(repoFullName)) errors.repo = "Select the repository this workspace will work on.";
  if (Object.keys(errors).length) return { errors };

  const token = await getGithubToken(user.id);
  if (!token) return { errors: { repo: "Connect your GitHub account to select a repository." } };

  let workspaceId: number;
  try {
    // Re-validate against GitHub: the client only sends a name, never trusted repo metadata.
    const repo = await getLinkableRepo(token, repoFullName);
    if (!repo) return { errors: { repo: "You need push access to link this repository." } };

    const logoKey = logoFile ? await uploadWorkspaceLogo(user.id, logoFile) : null;
    const workspace = await insertWorkspace({
      ownerId: user.id,
      name,
      icon: icon as string,
      logoKey,
      githubRepoId: repo.id,
      githubRepoFullName: repo.fullName,
      githubRepoUrl: repo.url,
      githubDefaultBranch: repo.defaultBranch,
      githubRepoPrivate: repo.private,
    });
    workspaceId = workspace.id;
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) {
      await deleteGithubConnection(user.id);
      return { errors: { repo: "Your GitHub connection expired. Connect GitHub again." } };
    }
    if (error instanceof GithubError && error.status === 404) {
      return { errors: { repo: "That repository no longer exists or you lost access to it." } };
    }
    console.error("[workspaces] create failed", error);
    return { message: "We couldn't create the workspace. Please try again." };
  }

  redirect(`/dashboard/${workspaceId}`);
}

export async function disconnectGithub() {
  const user = await requireUser("/workspaces/new");
  await deleteGithubConnection(user.id);
  redirect("/workspaces/new");
}
