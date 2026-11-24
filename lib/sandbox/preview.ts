import "server-only";

import { randomInt } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";

import { agentRuns, db, pullRequests, workspaces } from "@/db";
import { getBranchSha, getGithubToken, getRepoTarball } from "@/lib/github";
import {
  LOCAL_PREVIEW_DOMAIN,
  PREVIEW_MAX_AGE_MS,
  PREVIEW_PORT,
  PREVIEW_READY_TIMEOUT_MS,
  SANDBOX_TIMEOUT_SECONDS,
  allowInstallScriptsOf,
  isPreviewDomain,
  isPreviewExpired,
  parseRunPreview,
  previewHost,
  previewTarget,
  previewUrl,
  sandboxCommandsOf,
  type RunPreview,
} from "@/lib/sandbox/config";
import { launchPreview, listPreviewNetworks, localPreviewAddress, previewAddress, probePreview, removePreview } from "@/lib/sandbox/docker";
import { dockerMode } from "@/lib/sandbox/cli";
import { getSandboxStatus, previewsSupported } from "@/lib/sandbox/status";

/**
 * Live previews of agent pull requests (Settings → Sandbox → Previews): on a remote sandbox host at
 * https://pr-<n>-<random>.<domain>, on this computer's own Docker at http://127.0.0.1:<port> (loopback only). One per
 * run, in agent_runs.preview; lib/sandbox/docker.ts runs the containers. Nothing here throws into the pipeline: a
 * preview that fails is reported, and the run goes on.
 */

/** SANDBOX_PREVIEW_DOMAIN: previews are served at its subdomains (a wildcard DNS record to the sandbox host). */
export function previewDomain() {
  const domain = process.env.SANDBOX_PREVIEW_DOMAIN?.trim().toLowerCase();
  return domain && isPreviewDomain(domain) ? domain : null;
}

/** The server can serve previews: a ready sandbox, and on a remote host a preview domain too. Otherwise the switch stays off. */
export function previewsAvailable() {
  return previewsSupported(previewDomain());
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomSlug = () => Array.from({ length: 6 }, () => SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]).join("");

const LIVE = sql`(${agentRuns.preview}->>'status') in ('starting', 'running')`;

/** Merges `patch` into the run's preview, only while it's still this preview (same host) in one of `statuses`. */
async function patchPreview(runId: number, host: string, statuses: RunPreview["status"][], patch: Partial<RunPreview>) {
  const rows = await db
    .update(agentRuns)
    .set({ preview: sql`${agentRuns.preview} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(
      and(
        eq(agentRuns.id, runId),
        sql`${agentRuns.preview}->>'host' = ${host}`,
        sql`(${agentRuns.preview}->>'status') in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`
      )
    )
    .returning({ preview: agentRuns.preview });
  return rows[0] ? parseRunPreview(rows[0].preview) : null;
}

async function failPreview(runId: number, preview: RunPreview, reason: string) {
  const failed = await patchPreview(runId, preview.host, ["starting", "running"], { status: "failed", reason, endedAt: new Date().toISOString() });
  await removePreview(runId);
  return failed;
}

export type PreviewStart =
  /** Previews are off, or there's nothing to preview yet (no open pull request, no command). */
  | { kind: "skipped"; why: string }
  /** The container started; pollRunPreview says when it answers. */
  | { kind: "starting"; preview: RunPreview }
  | { kind: "failed"; preview: RunPreview };

/**
 * Starts the run's preview on its branch's latest commit (after the CI gate). A rework round restarts it under the
 * same host; another run's preview of the same pull request is stopped first. Never throws.
 */
export async function startRunPreview(runId: number): Promise<PreviewStart> {
  const [row] = await db
    .select({ run: agentRuns, workspace: workspaces, pr: pullRequests })
    .from(agentRuns)
    .innerJoin(workspaces, eq(workspaces.id, agentRuns.workspaceId))
    .leftJoin(pullRequests, eq(pullRequests.runId, agentRuns.id))
    .where(eq(agentRuns.id, runId));
  if (!row) return { kind: "skipped", why: "The run is gone." };
  const { run, workspace, pr } = row;
  const commands = sandboxCommandsOf(workspace.sandboxCommands);
  const domain = previewDomain();
  if (!workspace.sandboxPreview || !workspace.sandboxEnabled) return { kind: "skipped", why: "Previews are off." };
  if (!(await previewsAvailable())) return { kind: "skipped", why: "This server can't serve previews." };
  const local = dockerMode() === "local";
  if (!commands?.preview) return { kind: "skipped", why: "No preview command is saved." };
  if (run.status !== "running") return { kind: "skipped", why: "The run isn't running." };
  if (!pr || pr.state !== "open" || !run.branch) return { kind: "skipped", why: "There's no open pull request." };

  const token = await getGithubToken(workspace.ownerId).catch(() => null);
  if (!token) return { kind: "skipped", why: "GitHub isn't connected." };
  const sha = await getBranchSha(token, workspace.githubRepoFullName, run.branch).catch(() => null);
  if (!sha) return { kind: "skipped", why: "The branch has no commit to preview." };

  await stopOtherPreviews(workspace.id, pr.number, runId);

  const earlier = parseRunPreview(run.preview);
  const preview: RunPreview = {
    status: "starting",
    host: earlier?.prNumber === pr.number ? earlier.host : previewHost(pr.number, randomSlug(), local ? LOCAL_PREVIEW_DOMAIN : domain!),
    prNumber: pr.number,
    round: run.reworkRounds,
    sha,
    startedAt: new Date().toISOString(),
    readyAt: null,
    endedAt: null,
    reason: null,
  };
  await db.update(agentRuns).set({ preview, updatedAt: new Date() }).where(eq(agentRuns.id, runId));

  let launched;
  try {
    launched = await launchPreview({
      runId,
      host: preview.host,
      source: () => getRepoTarball(token, workspace.githubRepoFullName, sha),
      install: commands.install,
      allowScripts: allowInstallScriptsOf(workspace.sandboxCommands),
      command: commands.preview,
      timeoutMs: SANDBOX_TIMEOUT_SECONDS * 1000,
    });
  } catch (error) {
    console.error("[preview] launch failed", error);
    launched = { ok: false as const, reason: "The sandbox host couldn't be reached." };
  }
  if (!launched.ok) {
    const failed = await failPreview(runId, preview, launched.reason);
    return { kind: "failed", preview: failed ?? { ...preview, status: "failed", reason: launched.reason } };
  }
  // Stopped (or replaced) while it was being prepared: the container started after the stop removed everything.
  const [current] = await db.select({ preview: agentRuns.preview }).from(agentRuns).where(eq(agentRuns.id, runId));
  const now = parseRunPreview(current?.preview);
  if (now?.host !== preview.host || now.status !== "starting") {
    await removePreview(runId);
    return { kind: "skipped", why: "The preview was stopped while it started." };
  }
  return { kind: "starting", preview };
}

/**
 * One readiness check of a starting preview: running once it answers, failed when its command exited or it didn't
 * answer within PREVIEW_READY_TIMEOUT_MS (then its resources are removed). `done` once it's no longer starting.
 */
export async function pollRunPreview(runId: number): Promise<{ done: boolean; preview: RunPreview | null }> {
  const [row] = await db.select({ preview: agentRuns.preview }).from(agentRuns).where(eq(agentRuns.id, runId));
  const preview = parseRunPreview(row?.preview);
  if (!preview || preview.status !== "starting") return { done: true, preview };

  let probe;
  try {
    probe = await probePreview(runId);
  } catch (error) {
    console.warn("[preview] probe failed", error);
    probe = { state: "waiting" as const };
  }
  // A local preview answers at http://127.0.0.1:<port>: ready only once Docker says which port.
  const local = dockerMode() === "local";
  const url = probe.state === "ready" && local ? await localPreviewAddress(runId).catch(() => null) : null;
  if (probe.state === "ready" && (!local || url)) {
    const running = await patchPreview(runId, preview.host, ["starting"], { status: "running", readyAt: new Date().toISOString(), ...(url ? { url } : {}) });
    return { done: true, preview: running };
  }
  const reason =
    probe.state === "exited"
      ? `The preview command exited (code ${probe.exitCode ?? "?"}) before the app answered.`
      : probe.state === "missing"
        ? "The preview container is gone."
        : Date.now() - new Date(preview.startedAt).getTime() > PREVIEW_READY_TIMEOUT_MS
          ? `The app didn't answer on port ${PREVIEW_PORT} within ${PREVIEW_READY_TIMEOUT_MS / 60_000} minutes.`
          : null;
  if (!reason) return { done: false, preview };
  return { done: true, preview: await failPreview(runId, preview, reason) };
}

/**
 * Stops the run's preview if it's live: marked stopped with `reason` first (the UI drops the link at once), then the
 * container, network and volume are removed. Never throws.
 */
export async function stopRunPreview(runId: number, reason: string) {
  try {
    const rows = await db
      .update(agentRuns)
      .set({
        preview: sql`${agentRuns.preview} || ${JSON.stringify({ status: "stopped", reason, endedAt: new Date().toISOString() })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(agentRuns.id, runId), LIVE))
      .returning({ id: agentRuns.id });
    if (rows.length) await removePreview(runId);
  } catch (error) {
    console.error("[preview] stop failed", error);
  }
}

async function livePreviewRuns(where: ReturnType<typeof and>) {
  return db.select({ id: agentRuns.id, preview: agentRuns.preview }).from(agentRuns).where(and(LIVE, where));
}

/** Another run's preview of the same pull request: a rerun replaces it. */
async function stopOtherPreviews(workspaceId: number, prNumber: number, runId: number) {
  const others = await livePreviewRuns(
    and(eq(agentRuns.workspaceId, workspaceId), ne(agentRuns.id, runId), sql`(${agentRuns.preview}->>'prNumber')::int = ${prNumber}`)
  );
  await Promise.all(others.map((other) => stopRunPreview(other.id, "Replaced by a newer run's preview.")));
}

/** A pull request was merged or closed: its previews go. Never throws. */
export async function stopPullRequestPreviews(workspaceId: number, prNumber: number, reason: string) {
  try {
    const runs = await livePreviewRuns(and(eq(agentRuns.workspaceId, workspaceId), sql`(${agentRuns.preview}->>'prNumber')::int = ${prNumber}`));
    await Promise.all(runs.map((run) => stopRunPreview(run.id, reason)));
  } catch (error) {
    console.error("[preview] stop for the pull request failed", error);
  }
}

// Containers whose run has no live preview are left alone this long: a launch may be between its steps.
const ORPHAN_GRACE_MS = 15 * 60 * 1000;

/**
 * Stops previews older than PREVIEW_MAX_AGE_MS, then removes what the sandbox host still holds for runs without a
 * live preview (a stop that didn't get through). Called by the preview sweep cron.
 */
export async function sweepPreviews() {
  const live = await livePreviewRuns(undefined);
  let expired = 0;
  for (const run of live) {
    const preview = parseRunPreview(run.preview);
    if (preview && isPreviewExpired(preview)) {
      await stopRunPreview(run.id, `Stopped after ${PREVIEW_MAX_AGE_MS / 3_600_000} hours.`);
      expired++;
    }
  }
  if ((await getSandboxStatus()).state !== "ready") return { expired, orphans: 0 };
  const stillLive = new Set(live.map((run) => run.id));
  const orphans = (await listPreviewNetworks()).filter(
    ({ runId, createdAt }) => !stillLive.has(runId) && Date.now() - createdAt.getTime() > ORPHAN_GRACE_MS
  );
  for (const { runId } of orphans) await removePreview(runId);
  return { expired, orphans: orphans.length };
}

export type PreviewEndpoint = {
  /** https://pr-<n>-<random>.<domain>, or http://127.0.0.1:<port> on this computer's own Docker. */
  publicUrl: string;
  /** previewTarget(runId): the container and its internal network share the name. */
  container: string;
  network: string;
  internalUrl: string;
  /** The container's address on `network`, for `--add-host=<container>:<address>` (gVisor containers can't resolve names). */
  address: string | null;
};

/** Where a run's running preview answers, for a browser on the sandbox host. Null unless it's running. */
export async function getRunPreviewEndpoint(runId: number): Promise<PreviewEndpoint | null> {
  const [row] = await db.select({ preview: agentRuns.preview }).from(agentRuns).where(eq(agentRuns.id, runId));
  const preview = parseRunPreview(row?.preview);
  if (preview?.status !== "running") return null;
  const target = previewTarget(runId);
  const address = await previewAddress(runId).catch(() => null);
  return { publicUrl: previewUrl(preview), ...target, address };
}
