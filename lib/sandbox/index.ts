import "server-only";

import type { Workspace } from "@/db";
import { getGithubToken, getRepoFile, getRepoTarball, listRootFiles } from "@/lib/github";
import { detectCommands, type SandboxCommands, type SandboxRun } from "@/lib/sandbox/config";
import { removeSandbox, runInSandbox, sandboxHost } from "@/lib/sandbox/docker";

/**
 * Agent sandboxes for a workspace's repository: detection of the commands, the agent runs and the Settings check.
 * lib/sandbox/docker.ts holds the one implementation (Docker under gVisor); everything else goes through here.
 */

/** The server has a sandbox host (SANDBOX_DOCKER_HOST). Without one, the sandbox can't be switched on. */
export function sandboxAvailable() {
  return sandboxHost() !== null;
}

type RepoRef = Pick<Workspace, "ownerId" | "githubRepoFullName" | "githubDefaultBranch">;

async function ownerToken(workspace: Pick<Workspace, "ownerId">) {
  const token = await getGithubToken(workspace.ownerId);
  if (!token) throw new Error("GitHub isn't connected. Reconnect it and try again.");
  return token;
}

/** Install, test and build commands for the default branch, from package.json and the root lockfiles. */
export async function detectRepoCommands(workspace: RepoRef): Promise<SandboxCommands> {
  const token = await ownerToken(workspace);
  const [manifest, rootFiles] = await Promise.all([
    getRepoFile(token, workspace.githubRepoFullName, "package.json", workspace.githubDefaultBranch),
    listRootFiles(token, workspace.githubRepoFullName, workspace.githubDefaultBranch),
  ]);
  return detectCommands(manifest?.content ?? null, rootFiles);
}

/** The volume a run's sandbox calls share, so dependencies install once per run. */
export const runSandboxKey = (runId: number) => `run-${runId}`;

/** Runs `command` on `ref` (a branch or commit) in the run's sandbox, installing dependencies first when needed. */
export function runRepoCommand(input: { token: string; repo: string; ref: string; runId: number; install: string | null; command: string }) {
  return runInSandbox({
    key: runSandboxKey(input.runId),
    source: () => getRepoTarball(input.token, input.repo, input.ref),
    install: input.install,
    command: input.command,
  });
}

/** Frees a run's sandbox volume once the run has ended. Never throws. */
export function removeRunSandbox(runId: number) {
  return removeSandbox(runSandboxKey(runId));
}

/**
 * Settings → Sandbox → Test the sandbox: installs and runs the test command (else the build, else `node --version`)
 * on the default branch, in the workspace's own check volume.
 */
export async function checkSandbox(workspace: Pick<Workspace, "id"> & RepoRef, commands: SandboxCommands): Promise<SandboxRun> {
  const token = await ownerToken(workspace);
  return runInSandbox({
    key: `check-${workspace.id}`,
    source: () => getRepoTarball(token, workspace.githubRepoFullName, workspace.githubDefaultBranch),
    install: commands.install,
    command: commands.test ?? commands.build ?? "node --version",
  });
}
