import "server-only";

import { and, count, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db, memoryProposals, memorySignals, tasks, workspaces, type Workspace } from "@/db";
import { configAI, configAIErrorMessage, structuredReply, type ConfigAI, type StructuredInput } from "@/lib/agent-ai";
import { isSimulatedAgents } from "@/lib/agent-simulated";
import { activeAgentModel, checkAgentCanRun, logAgentActivity, taskKeyPrefix, updateAgentActivity } from "@/lib/agents";
import { getAIKeys } from "@/lib/ai-keys";
import { GithubError, getBranchSha, getGithubToken, listRepoFiles } from "@/lib/github";
import {
  BOOTSTRAP_SCHEMA,
  LEARN_SCHEMA,
  bootstrapPrompt,
  learnPrompt,
  selectNotes,
  selectSignals,
  validateBootstrap,
  validateLearning,
  type CheckedAnswer,
  type LibrarianSignal,
  type PastProposal,
  type ProposalDraft,
} from "@/lib/librarian";
import { sendLibrarianEvent, MEMORY_LEARN } from "@/lib/librarian-request";
import { simulatedBootstrap, simulatedLearning } from "@/lib/librarian-simulated";
import { getMemoryMode, loadMemory, repoReader } from "@/lib/memory";
import { readRepositoryFacts } from "@/lib/memory-bootstrap";
import {
  LEARN_SIGNALS_MAX,
  PROPOSAL_STATUSES,
  currentLibrarianState,
  isProposalKind,
  learnDecision,
  librarianBusy,
  type LibrarianJob,
  type LibrarianRequest,
  type LibrarianState,
  type ProposalOrigin,
} from "@/lib/memory-proposals";
import { isSignalKind } from "@/lib/memory-signals";
import { modelProvider } from "@/lib/model-catalog-config";

/**
 * The librarian's run (docs/brain-plan.md): one structured model call without tools or write access, turned into
 * proposals by lib/librarian.ts. It runs on the Lead's budget (paused or spent: no run) with an API key, the company of
 * the Lead's model first; the owner's Claude plan isn't used. Signals are marked used only when a run succeeds, in the
 * same transaction as its proposals. With AGENTS_SIMULATED=true a script stands in for the model.
 */

export type LibrarianAccess = { ok: true; leadId: number; ai: ConfigAI | null } | { ok: false; reason: string; needsKey?: boolean };

/** Whether the librarian can run for a workspace now, and on what (`ai` null: simulated, no model is called). */
export async function librarianAccess(workspace: Pick<Workspace, "id" | "memoryMode">): Promise<LibrarianAccess> {
  const no = (reason: string, needsKey?: boolean) => ({ ok: false as const, reason, needsKey });
  if (getMemoryMode(workspace) === "off") return no("Memory is off for this project. Turn it on in the settings below.");
  const lead = await checkAgentCanRun(workspace.id, "lead");
  if (!lead.ok) {
    if (lead.reason === "paused") return no("The Lead is paused, and the librarian runs on its budget. Resume it on the AI Team page.");
    if (lead.reason === "budget") return no("The Lead has used this month's budget, which pays for the librarian. Raise it on the AI Team page.");
    return no(lead.error);
  }
  if (isSimulatedAgents()) return { ok: true, leadId: lead.row.id, ai: null };
  const ai = configAI(await getAIKeys(workspace.id), modelProvider(activeAgentModel(lead.row)) ?? "openai");
  if (!ai) return no("Add an API key in Settings → AI. The librarian uses API keys, not your Claude plan.", true);
  return { ok: true, leadId: lead.row.id, ai };
}

/** What there is to learn from, and how full the inbox is. */
export async function librarianFacts(workspaceId: number) {
  const [[signals], [pending]] = await Promise.all([
    db
      .select({ unconsumed: count(), trusted: sql<number>`count(*) filter (where ${memorySignals.trusted})::int` })
      .from(memorySignals)
      .where(and(eq(memorySignals.workspaceId, workspaceId), isNull(memorySignals.consumedAt))),
    db
      .select({ pending: count() })
      .from(memoryProposals)
      .where(and(eq(memoryProposals.workspaceId, workspaceId), eq(memoryProposals.status, "pending"))),
  ]);
  return { unconsumed: signals?.unconsumed ?? 0, trusted: signals?.trusted ?? 0, pending: pending?.pending ?? 0 };
}

async function setState(workspaceId: number, state: Omit<LibrarianState, "at">) {
  await db
    .update(workspaces)
    .set({ memoryLibrarian: { ...state, at: new Date().toISOString() } })
    .where(eq(workspaces.id, workspaceId));
}

const idle = { proposals: 0, costMicros: 0 };

/** "Learn now" and "Build a first memory": checks, marks the run as queued and asks the job runner for it. */
export async function requestLibrarianRun(workspace: Workspace, job: LibrarianJob): Promise<{ ok: true } | { ok: false; message: string }> {
  if (librarianBusy(currentLibrarianState(workspace.memoryLibrarian, new Date()))) return { ok: false, message: "The librarian is already working." };
  const access = await librarianAccess(workspace);
  if (!access.ok) return { ok: false, message: access.reason };
  if (job === "learn") {
    const decision = learnDecision({ trigger: "manual", mode: getMemoryMode(workspace), autoLearn: workspace.memoryAutoLearn, ...(await librarianFacts(workspace.id)) });
    if (!decision.run) return { ok: false, message: decision.reason };
  }
  const request = { workspaceId: workspace.id, job, trigger: "manual" as const };
  await setState(workspace.id, { state: "queued", job, trigger: "manual", message: "", ...idle });
  if (await sendLibrarianEvent({ name: MEMORY_LEARN, data: request })) return { ok: true };
  const message = "Couldn't reach the job runner. Check that the Inngest Dev Server is running, then try again.";
  await setState(workspace.id, { state: "failed", job, trigger: "manual", message, ...idle });
  return { ok: false, message };
}

// ── The run ────────────────────────────────────────────────────────────────────

/** A failure with words for the owner. */
class LibrarianFailure extends Error {}

type Run = { workspace: Workspace; access: Extract<LibrarianAccess, { ok: true }>; spent: { costMicros: number; activityId: number | null } };

/** The model's answer (or the script's), with its cost logged on the Lead before anything is read from it. */
async function ask(run: Run, job: LibrarianJob, input: StructuredInput, simulate: () => unknown): Promise<unknown> {
  const { ai, leadId } = run.access;
  const log = async (costMicros: number, detail: string) => {
    run.spent.costMicros = costMicros;
    run.spent.activityId = await logAgentActivity({
      workspaceId: run.workspace.id,
      agentId: leadId,
      kind: "memory",
      title: job === "learn" ? "Librarian: learning from signals" : "Librarian: reading the repository",
      detail,
      costMicros,
      createdAt: new Date(),
    });
  };
  if (!ai) {
    await log(0, "Simulated: no model was called.");
    return simulate();
  }
  const reply = await structuredReply(ai, input, { job, tier: job === "learn" ? "fast" : "balanced" });
  await log(reply.costMicros, reply.model);
  if (reply.refused) throw new LibrarianFailure("The model declined this request.");
  if (!reply.text) throw new LibrarianFailure("The model returned no answer.");
  try {
    return JSON.parse(reply.text) as unknown;
  } catch {
    throw new LibrarianFailure("The model's answer wasn't valid JSON.");
  }
}

/** The memory as it is now, and what was proposed before: what every answer is checked against. */
async function currentMemory(workspace: Workspace, token: string | null) {
  const memory = await loadMemory(workspace, token, { fresh: true });
  if (memory.problem) {
    throw new LibrarianFailure(
      memory.problem === "reconnect"
        ? "GitHub rejected the saved connection, so the repository's notes couldn't be read. Reconnect GitHub and try again."
        : "GitHub couldn't be reached, so the repository's notes couldn't be read. Try again in a moment."
    );
  }
  const notes = [...memory.project, ...memory.global];
  return { notes, shown: selectNotes(notes), history: await proposalHistory(workspace) };
}

/** This project's proposals and the owner's global ones from any project: what the dedupe compares with. */
async function proposalHistory(workspace: Pick<Workspace, "id" | "ownerId">): Promise<PastProposal[]> {
  const rows = await db
    .select()
    .from(memoryProposals)
    .where(and(eq(memoryProposals.userId, workspace.ownerId), or(eq(memoryProposals.workspaceId, workspace.id), eq(memoryProposals.scope, "global"))));
  return rows.flatMap((row): PastProposal[] => {
    const status = PROPOSAL_STATUSES.find((candidate) => candidate === row.status);
    if (!status || !isProposalKind(row.kind) || (row.scope !== "project" && row.scope !== "global")) return [];
    return [{ kind: row.kind, scope: row.scope, targetKey: row.targetKey, title: row.note?.title ?? row.target?.note.title ?? "", contentHash: row.contentHash, status }];
  });
}

/** The workspace's newest unused signals, with their card keys. */
async function unusedSignals(workspace: Pick<Workspace, "id" | "name">): Promise<LibrarianSignal[]> {
  const rows = await db
    .select({ signal: memorySignals, number: tasks.number })
    .from(memorySignals)
    .leftJoin(tasks, and(eq(tasks.id, memorySignals.taskId), eq(tasks.workspaceId, memorySignals.workspaceId)))
    .where(and(eq(memorySignals.workspaceId, workspace.id), isNull(memorySignals.consumedAt)))
    .orderBy(desc(memorySignals.createdAt), desc(memorySignals.id))
    .limit(LEARN_SIGNALS_MAX);
  const prefix = taskKeyPrefix(workspace.name);
  return rows.flatMap(({ signal, number }): LibrarianSignal[] => {
    if (!isSignalKind(signal.kind)) return [];
    return [
      {
        id: signal.id,
        kind: signal.kind,
        trusted: signal.trusted,
        payload: signal.payload,
        taskId: signal.taskId,
        card: number === null ? null : `${prefix}-${number}`,
        prNumber: signal.prNumber,
        createdAt: signal.createdAt,
      },
    ];
  });
}

function checked(answer: CheckedAnswer) {
  if (!answer.ok) throw new LibrarianFailure("The model's answer wasn't in the expected shape.");
  if (answer.dropped.length) console.info(`[librarian] left out ${answer.dropped.length}: ${answer.dropped.join("; ")}`);
  return answer;
}

/** What a successful run changes, all or nothing: its proposals, the signals it used and, for a bootstrap, its date. */
async function save(workspace: Workspace, proposals: ProposalDraft[], origin: ProposalOrigin, used: { ids: number[]; readAt: Date } | null) {
  const now = new Date();
  await db.transaction(async (tx) => {
    if (proposals.length) {
      await tx
        .insert(memoryProposals)
        .values(proposals.map((proposal) => ({ ...proposal, userId: workspace.ownerId, workspaceId: workspace.id, origin, status: "pending", createdAt: now, updatedAt: now })));
    }
    if (used?.ids.length) {
      await tx
        .update(memorySignals)
        .set({ consumedAt: now })
        // A signal the owner rewrote meanwhile has a later date: it stays unused.
        .where(and(eq(memorySignals.workspaceId, workspace.id), inArray(memorySignals.id, used.ids), lte(memorySignals.createdAt, used.readAt)));
    }
    if (origin === "bootstrap") await tx.update(workspaces).set({ memoryBootstrappedAt: now }).where(eq(workspaces.id, workspace.id));
  });
}

const proposalsNoun = (n: number) => `${n} new proposal${n === 1 ? "" : "s"}`;
const outcome = (read: string, proposals: number, dropped: number) =>
  `${read}: ${proposals ? `${proposalsNoun(proposals)} to review` : "nothing new worth proposing"}${dropped ? ` (${dropped} left out: already known or not allowed)` : ""}.`;

async function learn(run: Run) {
  const { workspace } = run;
  const memory = await currentMemory(workspace, await getGithubToken(workspace.ownerId).catch(() => null));
  const readAt = new Date();
  const signals = selectSignals(await unusedSignals(workspace));
  const answer = await ask(run, "learn", { ...learnPrompt({ signals, notes: memory.shown, history: memory.history }), name: "memory_proposals", schema: LEARN_SCHEMA }, () =>
    simulatedLearning({ signals, notes: memory.shown })
  );
  const result = checked(validateLearning(answer, { ...memory, signals }));
  await save(workspace, result.proposals, "agent", { ids: signals.map((signal) => signal.id), readAt });
  return { proposals: result.proposals.length, message: outcome(`Read ${signals.length} signal${signals.length === 1 ? "" : "s"}`, result.proposals.length, result.dropped.length) };
}

async function bootstrap(run: Run) {
  const { workspace } = run;
  const token = await getGithubToken(workspace.ownerId);
  if (!token) throw new LibrarianFailure("Connect GitHub to read the repository.");
  const { githubRepoFullName: repo, githubDefaultBranch: branch } = workspace;
  // Every file is read at one commit.
  const sha = await getBranchSha(token, repo, branch);
  if (!sha) throw new LibrarianFailure(`The branch ${branch} wasn't found in ${repo}.`);
  const files = await readRepositoryFacts({ ...repoReader(token, repo, sha), listFiles: async () => (await listRepoFiles(token, repo, sha)).files });
  if (!files.length) throw new LibrarianFailure("The repository has no files to read.");
  const memory = await currentMemory(workspace, token);
  const answer = await ask(run, "bootstrap", { ...bootstrapPrompt({ files, notes: memory.shown, history: memory.history }), name: "memory_bootstrap", schema: BOOTSTRAP_SCHEMA }, () =>
    simulatedBootstrap(files)
  );
  const result = checked(validateBootstrap(answer, { ...memory, files: files.map((file) => file.path) }));
  await save(workspace, result.proposals, "bootstrap", null);
  return { proposals: result.proposals.length, message: outcome(`Read ${files.length} file${files.length === 1 ? "" : "s"} and listings`, result.proposals.length, result.dropped.length) };
}

function failureMessage(error: unknown, ai: ConfigAI | null) {
  if (error instanceof LibrarianFailure) return error.message;
  if (error instanceof GithubError) {
    return error.status === 401 ? "GitHub rejected the saved connection. Reconnect GitHub and try again." : "GitHub couldn't be read. Try again in a moment.";
  }
  if (ai) return configAIErrorMessage(ai, error);
  console.error("[librarian]", error instanceof Error ? error.message : error);
  return "The run failed. Please try again.";
}

/**
 * One run, from the job runner (one at a time per workspace). An automatic request that has nothing to do ends without
 * a trace; everything else leaves its outcome on the workspace. A failed run uses up no signal.
 */
export async function runLibrarian({ workspaceId, job, trigger }: LibrarianRequest) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace) return { skipped: "The workspace is gone." };
  const finish = async (state: "done" | "failed", message: string, proposals = 0, costMicros = 0) => {
    await setState(workspaceId, { state, job, trigger, message, proposals, costMicros });
    return { state, message, proposals };
  };

  if (job === "learn") {
    const decision = learnDecision({ trigger, mode: getMemoryMode(workspace), autoLearn: workspace.memoryAutoLearn, ...(await librarianFacts(workspaceId)) });
    if (!decision.run) return trigger === "manual" ? finish("done", decision.reason) : { skipped: decision.reason };
  }
  const access = await librarianAccess(workspace);
  if (!access.ok) return finish("failed", access.reason);

  await setState(workspaceId, { state: "running", job, trigger, message: "", ...idle });
  const run: Run = { workspace, access, spent: { costMicros: 0, activityId: null } };
  const record = async (title: string, detail: string) => {
    if (run.spent.activityId !== null) await updateAgentActivity(run.spent.activityId, { title, detail });
  };
  try {
    const result = job === "learn" ? await learn(run) : await bootstrap(run);
    await record(result.proposals ? `Librarian: ${proposalsNoun(result.proposals)}` : "Librarian: nothing new to propose", result.message);
    return finish("done", result.message, result.proposals, run.spent.costMicros);
  } catch (error) {
    const message = failureMessage(error, access.ai);
    await record("Librarian: the run failed", message);
    return finish("failed", message, 0, run.spent.costMicros);
  }
}
