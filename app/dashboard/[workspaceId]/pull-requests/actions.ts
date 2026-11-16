"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/current-user";
import { getWorkspacePullRequest, mergeManually } from "@/lib/pull-requests";
import { getOwnedWorkspace } from "@/lib/workspaces";

export type MergeActionResult = { ok: true } | { ok: false; error: string };

/** Merge from the Pull Requests page (manual merge mode). Checks and outcomes: mergeManually. */
export async function mergePullRequestAction(workspaceId: number, pullRequestId: number): Promise<MergeActionResult> {
  const user = await requireUser(`/dashboard/${workspaceId}/pull-requests`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const pr = await getWorkspacePullRequest(workspace.id, pullRequestId);
  if (!pr) return { ok: false, error: "This pull request is no longer open." };
  const result = await mergeManually(pr);
  revalidatePath(`/dashboard/${workspaceId}/pull-requests`);
  return result;
}
