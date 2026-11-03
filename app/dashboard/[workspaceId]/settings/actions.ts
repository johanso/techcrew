"use server";

import { revalidatePath } from "next/cache";

import { PROVIDERS, isAgentProvider } from "@/lib/agent-config";
import { getAIKeys, keyStatus, removeProviderKey, saveProviderKey, verifyProviderKey } from "@/lib/ai-keys";
import { switchAgentsToProvider } from "@/lib/agents";
import { requireUser } from "@/lib/current-user";
import { getOwnedWorkspace, updateAgentAutomation, updateAIProvider } from "@/lib/workspaces";

export type AutomationFormState = { ok?: boolean; message?: string; savedAt?: number };

const MODES = ["manual", "auto"] as const;
const isMode = (value: FormDataEntryValue | null): value is (typeof MODES)[number] => MODES.includes(value as never);

async function authorize(workspaceId: number) {
  const user = await requireUser(`/dashboard/${workspaceId}/settings`);
  return getOwnedWorkspace(user.id, workspaceId);
}

// Provider changes show on the AI Team page too (model picker, "not connected" labels, agent models).
function refresh(workspaceId: number) {
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/ai-team`);
}

/** Settings → Agents: how cards reach the analyst and how agent pull requests get merged. Bound to the workspace id. */
export async function saveAutomationAction(workspaceId: number, _prev: AutomationFormState, formData: FormData): Promise<AutomationFormState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };

  const pickup = formData.get("pickup");
  const merge = formData.get("merge");
  if (!isMode(pickup) || !isMode(merge)) return { message: "Choose an option for task pickup and for merging." };

  await updateAgentAutomation(workspace.id, { agentAutoPickup: pickup === "auto", agentAutoMerge: merge === "auto" });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { ok: true, savedAt: Date.now() };
}

export type ProviderSwitchState = { ok?: boolean; message?: string; switched?: number };

/** Settings → AI providers: the provider the team works on. Moves every agent to the equivalent model there. */
export async function switchProviderAction(workspaceId: number, _prev: ProviderSwitchState, formData: FormData): Promise<ProviderSwitchState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };
  const provider = formData.get("provider");
  if (!isAgentProvider(provider)) return { message: "Choose a provider." };
  if (!keyStatus(await getAIKeys(workspace.id))[provider]) {
    return { message: `Add an ${PROVIDERS[provider].label} API key below first.` };
  }

  try {
    await updateAIProvider(workspace.id, provider);
    const switched = await switchAgentsToProvider(workspace.id, provider);
    refresh(workspaceId);
    return { ok: true, switched };
  } catch (error) {
    console.error("[settings] provider switch failed", error);
    return { message: "We couldn't switch the provider. Please try again." };
  }
}

export type ProviderKeyState = { ok?: boolean; errors?: { apiKey?: string }; message?: string; savedAt?: number };

/**
 * Saves a workspace API key after checking it with the provider. The key is encrypted at rest and never sent back:
 * the form only ever shows its masked hint. Bound to the workspace id and provider (validated: bound args are input too).
 */
export async function saveProviderKeyAction(
  workspaceId: number,
  provider: unknown,
  _prev: ProviderKeyState,
  formData: FormData
): Promise<ProviderKeyState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };
  if (!isAgentProvider(provider)) return { message: "Unknown provider." };

  const raw = formData.get("apiKey");
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return { errors: { apiKey: "Paste your API key." } };
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return { errors: { apiKey: "That doesn't look like an API key." } };

  const verified = await verifyProviderKey(provider, key);
  if (!verified.ok) return { errors: { apiKey: verified.error } };

  try {
    await saveProviderKey(workspace.id, provider, key);
  } catch (error) {
    console.error("[settings] key save failed", error);
    return { message: "We couldn't save the key. Please try again." };
  }
  refresh(workspaceId);
  return { ok: true, savedAt: Date.now() };
}

export async function removeProviderKeyAction(workspaceId: number, provider: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!isAgentProvider(provider)) return { ok: false, error: "Unknown provider." };
  try {
    await removeProviderKey(workspace.id, provider);
  } catch (error) {
    console.error("[settings] key remove failed", error);
    return { ok: false, error: "We couldn't remove the key. Please try again." };
  }
  refresh(workspaceId);
  return { ok: true };
}
