"use server";

import { revalidatePath } from "next/cache";

import { PROVIDERS, isAgentKey, isAgentProvider } from "@/lib/agent-config";
import { isMergeMode } from "@/lib/agent-run-config";
import { UPLOAD_MAX_BYTES, formatBytes } from "@/lib/agent-skills-config";
import { getOwnedSkill } from "@/lib/agent-skills";
import { getAIKeys, keyStatus, removeProviderKey, saveProviderKey, verifyProviderKey } from "@/lib/ai-keys";
import { switchAgentsToProvider } from "@/lib/agents";
import { requireUser } from "@/lib/current-user";
import {
  connectSwitch,
  disconnectSwitch,
  getSwitchConnection,
  requestSwitchScans,
  setSwitchWeeklyScans,
  type ConnectSwitchField,
} from "@/lib/switch-trust";
import { deleteUploadedSkill, inspectSkillUpload, installSkillUpload, setSkillAssignments, type InspectResult } from "@/lib/skill-install";
import { normalizeInstanceUrl } from "@/lib/switch-trust-config";
import { checkSandbox, sandboxAvailable } from "@/lib/sandbox";
import { SANDBOX_COMMAND_KINDS, parseSandboxCommand, sandboxReport, type SandboxCommandKind, type SandboxCommands } from "@/lib/sandbox/config";
import { getOwnedWorkspace, updateAgentAutomation, updateAIProvider, updateAutoFailover, updateSandbox } from "@/lib/workspaces";

export type AutomationFormState = { ok?: boolean; message?: string; savedAt?: number };

const PICKUP_MODES = ["manual", "auto"] as const;
const isPickupMode = (value: FormDataEntryValue | null): value is (typeof PICKUP_MODES)[number] => PICKUP_MODES.includes(value as never);

async function authorize(workspaceId: number) {
  const user = await requireUser(`/dashboard/${workspaceId}/settings`);
  return getOwnedWorkspace(user.id, workspaceId);
}

// Provider changes show on the AI Team page too (model picker, "not connected" labels, agent models).
function refresh(workspaceId: number) {
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/settings/skills`);
  revalidatePath(`/dashboard/${workspaceId}/ai-team`);
}

/** Settings → Agents: how cards reach the analyst and how agent pull requests get merged. Bound to the workspace id. */
export async function saveAutomationAction(workspaceId: number, _prev: AutomationFormState, formData: FormData): Promise<AutomationFormState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };

  const pickup = formData.get("pickup");
  const merge = formData.get("merge");
  if (!isPickupMode(pickup) || !isMergeMode(merge)) return { message: "Choose an option for task pickup and for merging." };

  await updateAgentAutomation(workspace.id, { agentAutoPickup: pickup === "auto", agentMergeMode: merge });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { ok: true, savedAt: Date.now() };
}

export type SandboxFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<SandboxCommandKind, string>>;
  savedAt?: number;
};

/** Settings → Sandbox: whether agents may run code, and the install / test / build commands they run. */
export async function saveSandboxAction(workspaceId: number, _prev: SandboxFormState, formData: FormData): Promise<SandboxFormState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };

  const enabled = formData.get("enabled") === "on";
  const commands: SandboxCommands = { install: null, test: null, build: null };
  const errors: SandboxFormState["errors"] = {};
  for (const kind of SANDBOX_COMMAND_KINDS) {
    const parsed = parseSandboxCommand(formData.get(kind));
    if (parsed.ok) commands[kind] = parsed.command;
    else errors[kind] = parsed.error;
  }
  if (Object.keys(errors).length) return { errors };
  if (enabled && !sandboxAvailable()) return { message: "This server has no sandbox host. Set SANDBOX_DOCKER_HOST." };
  if (enabled && !commands.test && !commands.build) return { message: "Add a test or a build command for the agents to run." };

  await updateSandbox(workspace.id, { sandboxEnabled: enabled, sandboxCommands: commands });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/ai-team`);
  return { ok: true, savedAt: Date.now() };
}

export type SandboxCheckResult = { ok: true; passed: boolean; headline: string; output: string } | { ok: false; error: string };

/**
 * Settings → Sandbox → Test the sandbox: installs and runs the saved test (else build) command on the default branch.
 * The output goes back to the owner only; it is never stored.
 */
export async function checkSandboxAction(workspaceId: number): Promise<SandboxCheckResult> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!sandboxAvailable()) return { ok: false, error: "This server has no sandbox host. Set SANDBOX_DOCKER_HOST." };
  if (!workspace.sandboxCommands) return { ok: false, error: "Save the commands first." };

  try {
    const run = await checkSandbox(workspace, workspace.sandboxCommands);
    return { ok: true, passed: run.failedStep === null && !run.timedOut, headline: sandboxReport({ ...run, output: "" }), output: run.output };
  } catch (error) {
    console.error("Sandbox check failed", error);
    return { ok: false, error: "The sandbox couldn't run. Check that the sandbox host is reachable and try again." };
  }
}

/** Settings → AI providers: switch provider automatically when the current one runs out of credit mid-run. */
export async function saveAutoFailoverAction(workspaceId: number, enabled: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (typeof enabled !== "boolean") return { ok: false, error: "Choose on or off." };
  await updateAutoFailover(workspace.id, enabled);
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { ok: true };
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

export type ProviderKeyState = { ok?: boolean; errors?: { apiKey?: string }; message?: string; savedAt?: number; scansQueued?: number };

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
  // Switch evaluates the agents through their models, so a new key is a good moment to score them again.
  let scansQueued = 0;
  if (await getSwitchConnection(workspace.id)) {
    const user = await requireUser(`/dashboard/${workspaceId}/settings`);
    const scans = await requestSwitchScans({ workspaceId: workspace.id, trigger: "connected", userId: user.id });
    if (scans.ok) scansQueued = scans.queued;
  }
  refresh(workspaceId);
  return { ok: true, savedAt: Date.now(), scansQueued };
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

export type SwitchConnectionState = {
  ok?: boolean;
  errors?: Partial<Record<ConnectSwitchField, string>>;
  message?: string;
  savedAt?: number;
  /** Agents queued for a SwitchAgent scan by this connect, and why the rest weren't. */
  scansQueued?: number;
  scanError?: string;
};

const SWITCH_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Settings → Switch Trust: checks the key with Switch, saves the connection (key encrypted) and queues a SwitchAgent
 * scan of every agent. An empty key keeps the saved one, or uses the server's.
 */
export async function connectSwitchAction(workspaceId: number, _prev: SwitchConnectionState, formData: FormData): Promise<SwitchConnectionState> {
  const user = await requireUser(`/dashboard/${workspaceId}/settings`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  if (!workspace) return { message: "Workspace not found." };

  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const apiKey = text("apiKey");
  const tenantId = text("tenantId");
  const switchWorkspaceId = text("switchWorkspaceId");
  const errors: SwitchConnectionState["errors"] = {};
  if (apiKey && (apiKey.length < 16 || apiKey.length > 512 || /\s/.test(apiKey))) errors.apiKey = "That doesn't look like a Switch API key.";
  const instance = normalizeInstanceUrl(text("instanceUrl"));
  if (!instance.ok) errors.instanceUrl = instance.error;
  if (tenantId && !SWITCH_ID.test(tenantId)) errors.tenantId = "Check the tenant ID.";
  if (switchWorkspaceId && !SWITCH_ID.test(switchWorkspaceId)) errors.switchWorkspaceId = "Check the workspace ID.";
  if (Object.keys(errors).length || !instance.ok) return { errors };

  let connected: Awaited<ReturnType<typeof connectSwitch>>;
  try {
    connected = await connectSwitch(workspace.id, { apiKey: apiKey || null, instanceUrl: instance.value, tenantId, switchWorkspaceId });
  } catch (error) {
    console.error("[settings] switch connect failed", error);
    return { message: "We couldn't save the connection. Please try again." };
  }
  if (!connected.ok) return connected.field ? { errors: { [connected.field]: connected.error } } : { message: connected.error };

  const scans = await requestSwitchScans({ workspaceId: workspace.id, trigger: "connected", userId: user.id });
  refresh(workspaceId);
  return {
    ok: true,
    savedAt: Date.now(),
    scansQueued: scans.ok ? scans.queued : 0,
    scanError: scans.error,
  };
}

export async function disconnectSwitchAction(workspaceId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  try {
    await disconnectSwitch(workspace.id);
  } catch (error) {
    console.error("[settings] switch disconnect failed", error);
    return { ok: false, error: "We couldn't disconnect Switch Trust. Please try again." };
  }
  refresh(workspaceId);
  return { ok: true };
}

/** Settings → Switch Trust: scan every agent again each week (Mondays, 06:00 UTC). */
export async function saveSwitchWeeklyAction(workspaceId: number, enabled: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (typeof enabled !== "boolean") return { ok: false, error: "Choose on or off." };
  if (!(await setSwitchWeeklyScans(workspace.id, enabled))) return { ok: false, error: "Connect Switch Trust first." };
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { ok: true };
}

// ── Agent skills ───────────────────────────────────────────────────────────────

/** The uploaded file and the skill a new version replaces (validated: form fields are input too). */
async function uploadInput(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a SKILL.md or .zip file." } as const;
  if (file.size > UPLOAD_MAX_BYTES) return { error: `The file is larger than ${formatBytes(UPLOAD_MAX_BYTES)}.` } as const;
  const rawReplace = formData.get("replaceId");
  const replaceId = typeof rawReplace === "string" && rawReplace ? Number(rawReplace) : null;
  if (replaceId !== null && (!Number.isSafeInteger(replaceId) || replaceId <= 0)) return { error: "Unknown skill." } as const;
  return { name: file.name.slice(0, 200), bytes: Buffer.from(await file.arrayBuffer()), replaceId } as const;
}

/**
 * Settings → Agent skills, step 1: reads, validates and scans an upload (rules, plus one AI review when a provider key
 * exists) without installing it. Blocked skills come back with their findings; the rest with a sealed preview.
 */
export async function inspectSkillAction(workspaceId: number, formData: FormData): Promise<InspectResult> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const upload = await uploadInput(formData);
  if ("error" in upload) return { ok: false, error: upload.error! };
  try {
    const result = await inspectSkillUpload({ workspace, fileName: upload.name, bytes: upload.bytes, replaceId: upload.replaceId });
    // The AI review's cost shows in the Security agent's spend.
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/ai-team`);
    return result;
  } catch (error) {
    console.error("[settings] skill inspect failed", error);
    return { ok: false, error: "We couldn't read that skill. Please try again." };
  }
}

/** Step 2: the user confirmed type, load and the agents to assign. Installs the inspected file (sent again). */
export async function installSkillAction(workspaceId: number, formData: FormData): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const user = await requireUser(`/dashboard/${workspaceId}/settings`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const upload = await uploadInput(formData);
  if ("error" in upload) return { ok: false, error: upload.error! };
  const result = await installSkillUpload({
    workspace,
    user,
    fileName: upload.name,
    bytes: upload.bytes,
    token: formData.get("token"),
    replaceId: upload.replaceId,
    choices: { type: formData.get("type"), load: formData.get("load"), roles: formData.getAll("roles") },
  });
  if (!result.ok) return result;
  refresh(workspaceId);
  return { ok: true, name: result.name };
}

/** Which agents have a skill switched on (everyone not listed: off). */
export async function saveSkillAssignmentsAction(workspaceId: number, skillId: unknown, roles: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const skill = typeof skillId === "number" ? await getOwnedSkill(workspace.id, skillId) : null;
  if (!skill) return { ok: false, error: "Skill not found." };
  const keys = Array.isArray(roles) ? roles.filter(isAgentKey) : [];
  try {
    await setSkillAssignments(workspace.id, skill, keys);
  } catch (error) {
    console.error("[settings] skill assignments failed", error);
    return { ok: false, error: "We couldn't save the assignments. Please try again." };
  }
  refresh(workspaceId);
  return { ok: true };
}

export async function deleteSkillAction(workspaceId: number, skillId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (typeof skillId !== "number") return { ok: false, error: "Skill not found." };
  const result = await deleteUploadedSkill(workspace.id, skillId);
  if (!result.ok) return result;
  refresh(workspaceId);
  return { ok: true };
}
