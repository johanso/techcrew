import "server-only";

import type { Workspace } from "@/db";
import { getGithubToken, getRepoFile, getRepoTarball, listRootFiles } from "@/lib/github";
import { allowInstallScriptsOf, detectCommands, type SandboxCommands, type SandboxRun } from "@/lib/sandbox/config";
import { DEPENDENCY_FILE_MAX_BYTES } from "@/lib/sandbox/dependency-config";
import { addPackageInSandbox, removeSandbox, runInSandbox } from "@/lib/sandbox/docker";
import { getSandboxStatus } from "@/lib/sandbox/status";

/**
 * Agent sandboxes for a workspace's repository: detection of the commands, the agent runs and the Settings check.
 * lib/sandbox/docker.ts holds the one implementation (Docker: a prepared remote host under gVisor, or this computer's
 * own Docker); everything else goes through here.
 */

export { getSandboxStatus } from "@/lib/sandbox/status";

/** The sandbox can run (lib/sandbox/status.ts): without that it can't be switched on and agents get no sandbox tools. */
export async function sandboxAvailable() {
  return (await getSandboxStatus()).state === "ready";
}

type RepoRef = Pick<Workspace, "ownerId" | "githubRepoFullName" | "githubDefaultBranch">;

async function ownerToken(workspace: Pick<Workspace, "ownerId">) {
  // An unreadable saved token counts as no connection.
  const token = await getGithubToken(workspace.ownerId).catch(() => null);
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
export function runRepoCommand(input: { token: string; repo: string; ref: string; runId: number; install: string | null; allowScripts: boolean; command: string }) {
  return runInSandbox({
    key: runSandboxKey(input.runId),
    source: () => getRepoTarball(input.token, input.repo, input.ref),
    install: input.install,
    allowScripts: input.allowScripts,
    command: input.command,
  });
}

/**
 * add_dependency: runs `command` (addDependencyCommand) on `ref` in a volume of its own (removed afterwards, so the
 * run's checkout and node_modules stay as they were) and returns `files` as npm left them.
 */
export function addRepoDependency(input: { token: string; repo: string; ref: string; runId: number; command: string; files: string[] }) {
  return addPackageInSandbox({
    key: `deps-run-${input.runId}`,
    source: () => getRepoTarball(input.token, input.repo, input.ref),
    command: input.command,
    files: input.files,
    maxFileBytes: DEPENDENCY_FILE_MAX_BYTES,
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
export async function checkSandbox(workspace: Pick<Workspace, "id" | "sandboxCommands"> & RepoRef, commands: SandboxCommands): Promise<SandboxRun> {
  const token = await ownerToken(workspace);
  return runInSandbox({
    key: `check-${workspace.id}`,
    source: () => getRepoTarball(token, workspace.githubRepoFullName, workspace.githubDefaultBranch),
    install: commands.install,
    allowScripts: allowInstallScriptsOf(workspace.sandboxCommands),
    command: commands.test ?? commands.build ?? "node --version",
  });
}
