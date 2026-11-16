"use server";

import { revalidatePath } from "next/cache";

import { PROVIDERS, isAgentKey, isSkillId, modelInfo, workspaceProvider, type AgentKey } from "@/lib/agent-config";
import { configAIErrorMessage, generateAgentConfig, getWorkspaceConfigAI, scanAgentWithAI } from "@/lib/agent-ai";
import { scanAgentRules, type TrustReport } from "@/lib/agent-trust";
import {
  getAgentRow,
  logAgentActivity,
  parseAgentConfigInput,
  saveTrustScan,
  updateAgentConfig,
  type AgentConfigField,
} from "@/lib/agents";
import { requireUser } from "@/lib/current-user";
import { requestSwitchScans, syncSwitchCostCap } from "@/lib/switch-trust";
import { getOwnedWorkspace } from "@/lib/workspaces";

type Failure = { ok: false; error: string };

/** Every AI Team action starts here: signed-in user, a workspace they own, a known agent role. */
async function authorize(workspaceId: number, key: unknown) {
  const user = await requireUser(`/dashboard/${workspaceId}/ai-team`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  if (!workspace || !isAgentKey(key)) return null;
  const agent = await getAgentRow(workspace.id, key);
  return agent ? { user, workspace, agent, key: key as AgentKey } : null;
}

// Re-render the page so cards, stats, spend and activity reflect the change; open dialogs keep their local state.
const refresh = (workspaceId: number) => revalidatePath(`/dashboard/${workspaceId}/ai-team`);

export type SaveAgentResult = { ok: true } | (Failure & { errors?: Partial<Record<AgentConfigField, string>> });

export async function saveAgentAction(workspaceId: number, key: string, raw: unknown): Promise<SaveAgentResult> {
  const auth = await authorize(workspaceId, key);
  if (!auth) return { ok: false, error: "Agent not found." };
  const input = parseAgentConfigInput(raw);
  if (!input.ok) return input;
  // The team works with one company at a time (Settings → AI providers); each agent picks a model from it.
  const provider = workspaceProvider(auth.workspace);
  if (modelInfo(input.value.model).provider !== provider) {
    const label = PROVIDERS[provider].label;
    return { ok: false, error: "Check the highlighted fields.", errors: { model: `Pick an ${label} model, or switch company in Settings → AI providers.` } };
  }
  try {
    await updateAgentConfig(auth.workspace.id, auth.key, input.value);
  } catch (error) {
    console.error("[ai-team] save failed", error);
    return { ok: false, error: "We couldn't save the configuration. Please try again." };
  }
  if (input.value.monthlyBudgetCents !== auth.agent.monthlyBudgetCents) {
    await syncSwitchCostCap(auth.workspace.id, { ...auth.agent, monthlyBudgetCents: input.value.monthlyBudgetCents });
  }
  refresh(workspaceId);
  return { ok: true };
}

export type ScanAgentResult = { ok: true; report: TrustReport; notice?: string } | Failure;

/**
 * Scan again: re-scores the saved configuration. Adds an AI review when the workspace has a provider key; if that fails the rule scan still
 * runs, so the user always gets a fresh score.
 */
export async function scanAgentAction(workspaceId: number, key: string): Promise<ScanAgentResult> {
  const auth = await authorize(workspaceId, key);
  if (!auth) return { ok: false, error: "Agent not found." };
  const { agent } = auth;
  const input = {
    key: auth.key,
    description: agent.description,
    instructions: agent.instructions,
    skills: agent.skills.filter(isSkillId),
    monthlyBudgetCents: agent.monthlyBudgetCents,
  };

  let report: TrustReport;
  let costMicros = 0;
  let notice: string | undefined;
  const ai = await getWorkspaceConfigAI(auth.workspace);
  if (ai) {
    try {
      ({ report, costMicros } = await scanAgentWithAI({ ...input, ai }));
    } catch (error) {
      notice = `${configAIErrorMessage(ai, error)} Showing the rule-based scan.`;
      report = scanAgentRules(input);
    }
  } else {
    report = scanAgentRules(input);
  }

  try {
    await saveTrustScan(agent, report, costMicros);
  } catch (error) {
    console.error("[ai-team] scan save failed", error);
    return { ok: false, error: "We couldn't save the scan. Please try again." };
  }
  refresh(workspaceId);
  return { ok: true, report, notice };
}

/**
 * SwitchAgent Scan: queues one Switch Trust evaluation of the agent's saved configuration and returns at once.
 * The page shows the scan as pending and picks up the new score when the background job saves it.
 */
export async function switchScanAgentAction(workspaceId: number, key: string): Promise<{ ok: true } | Failure> {
  const auth = await authorize(workspaceId, key);
  if (!auth) return { ok: false, error: "Agent not found." };
  const result = await requestSwitchScans({ workspaceId: auth.workspace.id, trigger: "manual", userId: auth.user.id, keys: [auth.key] });
  if (!result.ok) return result;
  if (!result.queued) return { ok: false, error: result.error ?? "A SwitchAgent scan of this agent is already running." };
  refresh(workspaceId);
  return { ok: true };
}

export type GenerateAgentResult =
  | { ok: true; description: string; instructions: string; costMicros: number; repoAware: boolean }
  | Failure;

/**
 * Drafts a description and instructions with AI for the dialog's current skills and budget. Nothing is saved
 * until the user saves the dialog, but the model cost is logged right away (it was spent).
 */
export async function generateAgentAction(workspaceId: number, key: string, raw: unknown): Promise<GenerateAgentResult> {
  const auth = await authorize(workspaceId, key);
  if (!auth) return { ok: false, error: "Agent not found." };
  const ai = await getWorkspaceConfigAI(auth.workspace);
  if (!ai) return { ok: false, error: "Add an OpenAI or Anthropic API key in Settings → AI providers to generate with AI." };

  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const skills = Array.isArray(input.skills) ? [...new Set(input.skills.filter(isSkillId))] : [];
  const budgetUsd = typeof input.monthlyBudgetUsd === "number" && Number.isFinite(input.monthlyBudgetUsd) ? input.monthlyBudgetUsd : 0;
  const focus = typeof input.focus === "string" ? input.focus.trim().slice(0, 300) : "";
  if (!skills.length) return { ok: false, error: "Attach at least one skill first, so the instructions match what the agent can do." };

  try {
    const result = await generateAgentConfig({
      ai,
      key: auth.key,
      workspace: auth.workspace,
      skills,
      monthlyBudgetCents: Math.round(Math.max(0, budgetUsd) * 100) || auth.agent.monthlyBudgetCents,
      focus,
    });
    await logAgentActivity({
      workspaceId: auth.workspace.id,
      agentId: auth.agent.id,
      kind: "generated",
      title: "Drafted instructions with AI",
      detail: `Tailored to ${auth.workspace.githubRepoFullName}${result.repoAware ? "" : " (repository details unavailable)"}${focus ? `, focusing on “${focus}”` : ""}.`,
      costMicros: result.costMicros,
    });
    refresh(workspaceId);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: configAIErrorMessage(ai, error) };
  }
}
