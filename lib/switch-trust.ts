import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { agents, db, switchConnections, trustScans, workspaces, type AgentRow, type SwitchConnectionRow, type TrustScanRow } from "@/db";
import { AGENT_ROLES, PROVIDERS, modelInfo, workspaceProvider, type AgentKey } from "@/lib/agent-config";
import { activeAgentModel, saveTrustScan } from "@/lib/agents";
import { getAIKeys } from "@/lib/ai-keys";
import { decrypt, deriveSecret, encrypt } from "@/lib/crypto";
import { enqueueJob, getJobRun, jobsConfigured, JobsError, publicAppUrl } from "@/lib/jobs";
import {
  ensureSwitchAssignment,
  getSwitchAgentSummary,
  getSwitchRun,
  identifySwitchKey,
  listSwitchEvaluations,
  listSwitchRunResults,
  putSwitchAgentEndpoint,
  registerSwitchAgent,
  switchErrorMessage,
  SwitchApiError,
  triggerSwitchRun,
  type SwitchAuthScheme,
  type SwitchCredentials,
} from "@/lib/switch-api";
import {
  buildSwitchReport,
  isPendingScan,
  maskSwitchKey,
  pickFastEvaluation,
  runErrorMessage,
  runPhase,
  type TrustScanStatus,
  type TrustScanTrigger,
  type TrustScanView,
} from "@/lib/switch-trust-config";

/**
 * SwitchAgent scans: each agent is registered in the workspace's Switch Trust account, exposed to Switch at an
 * OpenAI-compatible endpoint (/api/switch-trust/agents/<id>/v1/chat/completions), and evaluated with ONE
 * evaluation — the fastest built-in one, not the whole catalog. The health score Switch reports becomes the agent's
 * trust score. A scan runs in the background: Cloudhike jobs call /api/switch-trust/scans/<id>, which advances it
 * (register → trigger → poll) and queues the next job while the run is still going.
 */

/** Server-wide fallback key, for workspaces that connect without pasting their own. */
const envSwitchKey = () => process.env.SWITCH_AGENT_AI_API_KEY || null;

// How long one job polls Switch before handing over to the next job, how often, and when a scan gives up.
const POLL_WINDOW_MS = 40_000;
const POLL_EVERY_MS = 5_000;
const SCAN_MAX_AGE_MS = 30 * 60_000;
// A pending scan nobody advanced for this long has lost its job (crashed, unreachable app).
const STALE_MS = 10 * 60_000;
// A queued scan older than this gets its job checked, to report an unreachable app early.
const JOB_CHECK_AFTER_MS = 60_000;

// ── Connection ─────────────────────────────────────────────────────────────────

export async function getSwitchConnection(workspaceId: number) {
  const [row] = await db.select().from(switchConnections).where(eq(switchConnections.workspaceId, workspaceId));
  return row ?? null;
}

function credentials(row: SwitchConnectionRow): SwitchCredentials | null {
  const apiKey = row.apiKey ? decrypt(row.apiKey) : envSwitchKey();
  if (!apiKey) return null;
  return {
    baseUrl: row.instanceUrl,
    apiKey,
    scheme: row.authScheme === "Bearer" ? "Bearer" : "ApiKey",
    tenantId: row.tenantId,
    workspaceId: row.switchWorkspaceId,
  };
}

/** Why scans can't run from this server right now (setup, not the user's account), or null. */
export function switchScanProblem() {
  if (!jobsConfigured()) return "Background jobs aren't configured on this server (JOBS_API_URL and JOBS_API_KEY).";
  if (!publicAppUrl()) {
    return "Switch and the jobs service can't reach this app at a local address. Set PUBLIC_APP_URL to a public URL (a deploy, or a tunnel such as ngrok).";
  }
  return null;
}

/** What Settings shows: never the key, only where it comes from and its masked hint. */
export type SwitchConnectionView = {
  connected: boolean;
  source: "workspace" | "environment" | null;
  hint: string | null;
  instanceUrl: string | null;
  tenantId: string | null;
  switchWorkspaceId: string | null;
  evaluationName: string | null;
  updatedAt: string | null;
  serverKeyAvailable: boolean;
  problem: string | null;
};

export async function getSwitchConnectionView(workspaceId: number): Promise<SwitchConnectionView> {
  const row = await getSwitchConnection(workspaceId);
  return {
    connected: row !== null,
    source: row ? (row.apiKey ? "workspace" : "environment") : null,
    hint: row?.hint ?? null,
    instanceUrl: row?.instanceUrl ?? null,
    tenantId: row?.tenantId ?? null,
    switchWorkspaceId: row?.switchWorkspaceId ?? null,
    evaluationName: row?.evaluationName ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    serverKeyAvailable: envSwitchKey() !== null,
    problem: switchScanProblem(),
  };
}

export type ConnectSwitchInput = { apiKey: string | null; instanceUrl: string; tenantId: string; switchWorkspaceId: string };
export type ConnectSwitchField = "apiKey" | "instanceUrl" | "tenantId" | "switchWorkspaceId";

/**
 * Checks the key with Switch (who it belongs to) and saves the connection, encrypted. Tenant and workspace come
 * from the key unless the user typed them. A null key keeps the saved one, or uses the server's.
 */
export async function connectSwitch(
  workspaceId: number,
  input: ConnectSwitchInput
): Promise<{ ok: true } | { ok: false; field?: ConnectSwitchField; error: string }> {
  const saved = await getSwitchConnection(workspaceId);
  const savedKey = saved?.apiKey ? decrypt(saved.apiKey) : null;
  const apiKey = input.apiKey ?? savedKey ?? envSwitchKey();
  if (!apiKey) return { ok: false, field: "apiKey", error: "Paste your Switch API key." };

  let identity: { scheme: SwitchAuthScheme; tenantId: string | null; workspaceId: string | null };
  try {
    identity = await identifySwitchKey(input.instanceUrl, apiKey);
  } catch (error) {
    const field = error instanceof SwitchApiError && error.status === 401 ? "apiKey" : error instanceof SwitchApiError && error.status === 0 ? "instanceUrl" : undefined;
    return { ok: false, field, error: switchErrorMessage(error) };
  }
  const tenantId = input.tenantId || identity.tenantId;
  const switchWorkspaceId = input.switchWorkspaceId || identity.workspaceId;
  if (!tenantId) return { ok: false, field: "tenantId", error: "Switch didn't say which tenant this key belongs to. Enter the tenant ID." };
  if (!switchWorkspaceId) return { ok: false, field: "switchWorkspaceId", error: "Enter the Switch workspace ID." };

  const ownKey = input.apiKey ?? savedKey;
  const sameAccount = saved?.instanceUrl === input.instanceUrl && saved.tenantId === tenantId && saved.switchWorkspaceId === switchWorkspaceId;
  const values = {
    apiKey: ownKey ? encrypt(ownKey) : null,
    hint: ownKey ? maskSwitchKey(ownKey) : null,
    authScheme: identity.scheme,
    instanceUrl: input.instanceUrl,
    tenantId,
    switchWorkspaceId,
    // Another account has its own catalog and agents: pick the evaluation and register the agents again there.
    ...(sameAccount ? {} : { evaluationId: null, evaluationName: null }),
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(switchConnections).values({ workspaceId, ...values }).onConflictDoUpdate({ target: switchConnections.workspaceId, set: values });
    if (!sameAccount) await tx.update(agents).set({ switchAgentId: null }).where(eq(agents.workspaceId, workspaceId));
  });
  return { ok: true };
}

/** Forgets the account: the key, the agents' Switch ids, and any scan still in progress. Nothing is deleted in Switch. */
export async function disconnectSwitch(workspaceId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(switchConnections).where(eq(switchConnections.workspaceId, workspaceId));
    await tx.update(agents).set({ switchAgentId: null }).where(eq(agents.workspaceId, workspaceId));
    await tx
      .update(trustScans)
      .set({ status: "failed", error: "Switch Trust was disconnected.", tokenHash: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(trustScans.workspaceId, workspaceId), inArray(trustScans.status, ["queued", "running"])));
  });
}

// ── Agent endpoint credential ──────────────────────────────────────────────────

/** The bearer token Switch sends when it tests one agent. Derived, so nothing is stored; one per agent. */
export function agentEndpointCredential(agentId: number) {
  return deriveSecret(`switch-eval-endpoint:${agentId}`);
}

export function verifyAgentEndpointCredential(agentId: number, presented: string) {
  return safeEqual(agentEndpointCredential(agentId), presented);
}

function safeEqual(expected: string, presented: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Adds the cost of answering one of Switch's tests to the agent's scan in progress. False when none is running. */
export async function addScanCost(agentId: number, costMicros: number) {
  const updated = await db
    .update(trustScans)
    .set({ costMicros: sql`${trustScans.costMicros} + ${costMicros}` })
    .where(and(eq(trustScans.agentId, agentId), inArray(trustScans.status, ["queued", "running"])))
    .returning({ id: trustScans.id });
  return updated.length > 0;
}

// ── Scans ──────────────────────────────────────────────────────────────────────

const toView = (row: TrustScanRow): TrustScanView => ({
  id: row.id,
  status: row.status as TrustScanStatus,
  trigger: row.trigger as TrustScanTrigger,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});

async function failScan(scanId: number, error: string): Promise<TrustScanStatus> {
  await db
    .update(trustScans)
    .set({ status: "failed", error, tokenHash: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(trustScans.id, scanId));
  return "failed";
}

/**
 * The latest scan of each agent of the workspace, keyed by agent id. Pending scans whose job died are closed here,
 * so a card never spins forever.
 */
export async function getLatestTrustScans(workspaceId: number): Promise<Map<number, TrustScanView>> {
  const rows = await db
    .selectDistinctOn([trustScans.agentId])
    .from(trustScans)
    .where(eq(trustScans.workspaceId, workspaceId))
    .orderBy(trustScans.agentId, desc(trustScans.createdAt), desc(trustScans.id));

  const now = Date.now();
  const views = new Map<number, TrustScanView>();
  for (const row of rows) {
    let current = row;
    if (isPendingScan(row.status)) {
      const idle = now - row.updatedAt.getTime();
      let error: string | null = idle > STALE_MS ? "The scan stopped responding. Run it again." : null;
      if (!error && row.status === "queued" && row.jobId && idle > JOB_CHECK_AFTER_MS) {
        const job = await getJobRun(row.jobId);
        if (job && ["failed", "cancelled"].includes(job.status)) {
          error = `The jobs service couldn't call the app${job.error ? ` (${job.error.slice(0, 120)})` : ""}. Check PUBLIC_APP_URL.`;
        }
      }
      if (error) {
        await failScan(row.id, error);
        current = { ...row, status: "failed", error, finishedAt: new Date() };
      }
    }
    views.set(row.agentId, toView(current));
  }
  return views;
}

/** Points a new Cloudhike job at the scan, with a fresh single-use token (only its hash is stored). */
async function queueScanJob(scanId: number) {
  const base = publicAppUrl();
  if (!base) throw new JobsError("The app has no public URL for the jobs service to call.");
  const token = randomBytes(32).toString("base64url");
  // Stored before queuing: the job can fire before enqueueJob returns.
  await db.update(trustScans).set({ tokenHash: sha256(token), updatedAt: new Date() }).where(eq(trustScans.id, scanId));
  const jobId = await enqueueJob({
    url: `${base}/api/switch-trust/scans/${scanId}`,
    headers: { authorization: `Bearer ${token}` },
    timeoutSeconds: 120,
    retries: 3,
  });
  await db.update(trustScans).set({ jobId }).where(eq(trustScans.id, scanId));
}

export type RequestScansResult = { ok: true; queued: number; skipped: number; error?: string } | { ok: false; error: string };

/**
 * Starts a SwitchAgent scan for each of `keys` (all four when omitted). Agents with a scan already in progress
 * are skipped. Returns at once; the score updates when the background job finishes.
 */
export async function requestSwitchScans(input: {
  workspaceId: number;
  trigger: TrustScanTrigger;
  userId: number | null;
  keys?: AgentKey[];
}): Promise<RequestScansResult> {
  const problem = switchScanProblem();
  if (problem) return { ok: false, error: problem };
  const connection = await getSwitchConnection(input.workspaceId);
  if (!connection || !credentials(connection)) return { ok: false, error: "Connect your Switch account in Settings → Switch Trust first." };

  const rows = await db.select().from(agents).where(eq(agents.workspaceId, input.workspaceId));
  const targets = rows.filter((row) => !input.keys || input.keys.includes(row.key as AgentKey));
  const [latest, keys, [workspace]] = await Promise.all([
    getLatestTrustScans(input.workspaceId),
    getAIKeys(input.workspaceId),
    db.select({ aiProvider: workspaces.aiProvider }).from(workspaces).where(eq(workspaces.id, input.workspaceId)),
  ]);
  const simulated = process.env.AGENTS_SIMULATED === "true";

  let queued = 0;
  let skipped = 0;
  let firstError: string | undefined;
  for (const row of targets) {
    const current = latest.get(row.id);
    if (current && isPendingScan(current.status)) {
      skipped++;
      continue;
    }
    // Switch tests the agent through its own model: without a key every test would fail, so say so now.
    const provider = modelInfo(activeAgentModel(row, workspaceProvider(workspace ?? { aiProvider: "openai" }))).provider;
    if (!simulated && !keys[provider]) {
      firstError ??= `Add an ${PROVIDERS[provider].label} API key in Settings → AI providers: Switch tests each agent through its model.`;
      continue;
    }
    const [scan] = await db
      .insert(trustScans)
      .values({ workspaceId: input.workspaceId, agentId: row.id, trigger: input.trigger, status: "queued", createdById: input.userId })
      .returning({ id: trustScans.id });
    try {
      await queueScanJob(scan!.id);
      queued++;
    } catch (error) {
      const message = error instanceof JobsError ? error.message : "We couldn't queue the scan.";
      if (!(error instanceof JobsError)) console.error("[switch] queue failed", error);
      await failScan(scan!.id, message);
      firstError ??= message;
    }
  }
  if (!queued && firstError) return { ok: false, error: firstError };
  return { ok: true, queued, skipped, error: firstError };
}

/** True when `token` is the one the scan's current job carries. */
export async function verifyScanToken(scanId: number, token: string) {
  const [row] = await db.select({ tokenHash: trustScans.tokenHash }).from(trustScans).where(eq(trustScans.id, scanId));
  return Boolean(row?.tokenHash) && safeEqual(row!.tokenHash!, sha256(token));
}

const switchAgentName = (workspace: { id: number; name: string }, key: AgentKey) =>
  `TechTeam ${workspace.name} (#${workspace.id}) · ${AGENT_ROLES[key].name}`;

/** Registers the agent (once), points Switch at its endpoint, makes sure it has the one evaluation, and starts a run. */
async function startEvaluation(agent: AgentRow, workspace: { id: number; name: string; aiProvider: string }, connection: SwitchConnectionRow, creds: SwitchCredentials) {
  const base = publicAppUrl();
  if (!base) throw new JobsError("The app has no public URL for Switch to call.");
  const key = agent.key as AgentKey;

  let switchAgentId = agent.switchAgentId;
  if (!switchAgentId) {
    switchAgentId = await registerSwitchAgent(creds, switchAgentName(workspace, key));
    await db.update(agents).set({ switchAgentId }).where(eq(agents.id, agent.id));
  }
  // Every scan: the model may have changed since, and the credential follows TOKEN_ENCRYPTION_KEY.
  await putSwitchAgentEndpoint(creds, switchAgentId, {
    url: `${base}/api/switch-trust/agents/${agent.id}`,
    credential: agentEndpointCredential(agent.id),
    modelName: activeAgentModel(agent, workspaceProvider(workspace)),
  });

  let evaluation = connection.evaluationId ? { id: connection.evaluationId, name: connection.evaluationName ?? "Switch evaluation" } : null;
  if (!evaluation) {
    const picked = pickFastEvaluation(await listSwitchEvaluations(creds));
    if (!picked) throw new SwitchApiError(404, "Your Switch workspace has no evaluations to run.");
    evaluation = { id: picked.id, name: picked.name };
    await db
      .update(switchConnections)
      .set({ evaluationId: picked.id, evaluationName: picked.name })
      .where(eq(switchConnections.id, connection.id));
  }

  const assignment = await ensureSwitchAssignment(creds, switchAgentId, evaluation);
  return { runId: await triggerSwitchRun(creds, assignment.id), switchAgentId, evaluation };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One background step of a scan (called by its Cloudhike job): start the evaluation if it hasn't started, then poll
 * the run for up to POLL_WINDOW_MS. Finished → the report is saved on the agent. Still running → the next job is
 * queued. Every failure ends the scan with a message for the owner rather than throwing.
 */
export async function advanceTrustScan(scanId: number): Promise<TrustScanStatus> {
  const [scan] = await db.select().from(trustScans).where(eq(trustScans.id, scanId));
  if (!scan) return "failed";
  if (!isPendingScan(scan.status)) return scan.status as TrustScanStatus;

  const [agent] = await db.select().from(agents).where(eq(agents.id, scan.agentId));
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, aiProvider: workspaces.aiProvider })
    .from(workspaces)
    .where(eq(workspaces.id, scan.workspaceId));
  const connection = await getSwitchConnection(scan.workspaceId);
  const creds = connection && credentials(connection);
  if (!agent || !workspace || !connection || !creds) return failScan(scan.id, "Switch Trust isn't connected anymore.");

  try {
    let runId = scan.switchRunId;
    let switchAgentId = agent.switchAgentId;
    let evaluationName = connection.evaluationName ?? "Switch evaluation";
    if (scan.status === "queued" || !runId) {
      const started = await startEvaluation(agent, workspace, connection, creds);
      runId = started.runId;
      switchAgentId = started.switchAgentId;
      evaluationName = started.evaluation.name;
      await db.update(trustScans).set({ status: "running", switchRunId: runId, updatedAt: new Date() }).where(eq(trustScans.id, scan.id));
    }

    const deadline = Date.now() + POLL_WINDOW_MS;
    let run = await getSwitchRun(creds, runId);
    while (runPhase(run.status) === "pending" && Date.now() < deadline) {
      await sleep(POLL_EVERY_MS);
      run = await getSwitchRun(creds, runId);
    }

    const phase = runPhase(run.status);
    if (phase === "failed") return failScan(scan.id, runErrorMessage(run));
    if (phase === "pending") {
      if (Date.now() - scan.createdAt.getTime() > SCAN_MAX_AGE_MS) return failScan(scan.id, "The Switch evaluation took longer than 30 minutes.");
      await queueScanJob(scan.id);
      return "running";
    }

    const [results, summary] = await Promise.all([listSwitchRunResults(creds, runId), getSwitchAgentSummary(creds, switchAgentId!)]);
    const report = buildSwitchReport({ evaluation: evaluationName, run, results, summary, scannedAt: new Date() });
    // Re-read: the endpoint added the cost of every test answered while this step was polling.
    const [fresh] = await db.select({ costMicros: trustScans.costMicros, status: trustScans.status }).from(trustScans).where(eq(trustScans.id, scan.id));
    if (!fresh || !isPendingScan(fresh.status)) return (fresh?.status as TrustScanStatus) ?? "failed";
    await saveTrustScan(agent, report, fresh.costMicros);
    await db
      .update(trustScans)
      .set({ status: "succeeded", error: null, tokenHash: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(trustScans.id, scan.id));
    return "succeeded";
  } catch (error) {
    const message = error instanceof JobsError ? error.message : switchErrorMessage(error);
    return failScan(scan.id, message);
  }
}
