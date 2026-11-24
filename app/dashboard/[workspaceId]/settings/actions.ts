"use server";

import { revalidatePath } from "next/cache";

import { isAgentKey, isAgentProvider, normalizeFallbackOrder } from "@/lib/agent-config";
import { isMergeMode } from "@/lib/agent-run-config";
import { UPLOAD_MAX_BYTES, formatBytes } from "@/lib/agent-skills-config";
import { getOwnedSkill } from "@/lib/agent-skills";
import { removeProviderKey, saveProviderKey, verifyProviderKey } from "@/lib/ai-keys";
import { accountMatches, describeAccount, isPlanLimitPolicy, isPlanLogin, type ClaudePlanView } from "@/lib/cli-agents-config";
import { cliAgentsAvailable, detectClaude, getCliSettings, saveCliSettings, signOutClaude, startClaudeSignIn } from "@/lib/cli";
import { getClaudePlanView } from "@/lib/cli/plan-view";
import { requireUser } from "@/lib/current-user";
import { refreshModelCatalog } from "@/lib/model-catalog";
import { deleteUploadedSkill, inspectSkillUpload, installSkillUpload, setSkillAssignments, type InspectResult } from "@/lib/skill-install";
import { checkSandbox, sandboxAvailable } from "@/lib/sandbox";
import {
  SANDBOX_COMMAND_KINDS,
  parseSandboxCommand,
  sandboxCommandsOf,
  sandboxReport,
  type SandboxCommandKind,
  type SandboxCommands,
} from "@/lib/sandbox/config";
import { previewsAvailable } from "@/lib/sandbox/preview";
import { getOwnedWorkspace, updateAgentAutomation, updateAutoFailover, updateFallbackOrder, updateSandbox } from "@/lib/workspaces";

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

/** Settings → Sandbox: whether agents may run code, the commands they run, and whether pull requests get previews. */
export async function saveSandboxAction(workspaceId: number, _prev: SandboxFormState, formData: FormData): Promise<SandboxFormState> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { message: "Workspace not found." };

  const enabled = formData.get("enabled") === "on";
  const preview = formData.get("preview_enabled") === "on";
  const commands: SandboxCommands = { install: null, test: null, build: null, preview: null };
  const errors: SandboxFormState["errors"] = {};
  for (const kind of SANDBOX_COMMAND_KINDS) {
    const parsed = parseSandboxCommand(formData.get(kind));
    if (parsed.ok) commands[kind] = parsed.command;
    else errors[kind] = parsed.error;
  }
  if (Object.keys(errors).length) return { errors };
  if (enabled && !sandboxAvailable()) return { message: "No sandbox host is set up on this computer (SANDBOX_DOCKER_HOST)." };
  if (enabled && !commands.test && !commands.build) return { message: "Add a test or a build command for the agents to run." };
  if (preview) {
    if (!previewsAvailable()) return { message: "This computer can't serve previews. Set SANDBOX_DOCKER_HOST and SANDBOX_PREVIEW_DOMAIN." };
    if (!enabled) return { message: "Previews run in the sandbox: switch it on too, or switch previews off." };
    if (!commands.preview) return { errors: { preview: "Add the command that serves your app, or switch previews off." } };
  }

  await updateSandbox(workspace.id, { sandboxEnabled: enabled, sandboxCommands: commands, sandboxPreview: preview });
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
  if (!sandboxAvailable()) return { ok: false, error: "No sandbox host is set up on this computer (SANDBOX_DOCKER_HOST)." };
  const commands = sandboxCommandsOf(workspace.sandboxCommands);
  if (!commands) return { ok: false, error: "Save the commands first." };

  try {
    const run = await checkSandbox(workspace, commands);
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

/**
 * Settings → AI → This workspace only: the order companies are tried in when one runs out. Anything that isn't a list
 * of known companies is refused; the stored order is the cleaned one (unlisted companies follow in the built-in order).
 */
export async function saveFallbackOrderAction(workspaceId: number, order: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const clean = normalizeFallbackOrder(order);
  if (!clean) return { ok: false, error: "Choose an order for the companies." };
  await updateFallbackOrder(workspace.id, clean);
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/board`);
  return { ok: true };
}

/**
 * Settings → AI → Refresh models: fetches OpenRouter's public model list now (no key, no spend). The catalog is shared
 * by every workspace, so any signed-in owner may refresh it.
 */
export async function refreshModelsAction(workspaceId: number): Promise<{ ok: true; models: number } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  const result = await refreshModelCatalog();
  if (result.ok) refresh(workspaceId);
  return result;
}

export type ProviderKeyState = { ok?: boolean; errors?: { apiKey?: string }; message?: string; savedAt?: number };

/**
 * Saves an API key after checking it with the provider, on the account (every workspace the user owns). The key is
 * encrypted at rest and never sent back: the form only ever shows its masked hint. Bound to the workspace id and
 * provider (validated: bound args are input too).
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
    await saveProviderKey(workspace.ownerId, provider, key);
  } catch (error) {
    console.error("[settings] key save failed", error);
    return { message: "We couldn't save the key. Please try again." };
  }
  refreshKeys();
  return { ok: true, savedAt: Date.now() };
}

// An account key serves every workspace the user owns: refresh all their dashboards.
const refreshKeys = () => revalidatePath("/dashboard", "layout");

export async function removeProviderKeyAction(workspaceId: number, provider: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!isAgentProvider(provider)) return { ok: false, error: "Unknown provider." };
  try {
    await removeProviderKey(workspace.ownerId, provider);
  } catch (error) {
    console.error("[settings] key remove failed", error);
    return { ok: false, error: "We couldn't remove the key. Please try again." };
  }
  refreshKeys();
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

// ── Plans on this computer (docs/cli-agents-plan.md) ───────────────────────────

const CLAUDE_PLAN_OPS = ["sign_in", "sign_out", "check", "confirm", "enable", "disable"] as const;
type ClaudePlanOp = (typeof CLAUDE_PLAN_OPS)[number];
const isClaudePlanOp = (value: unknown): value is ClaudePlanOp => CLAUDE_PLAN_OPS.includes(value as never);

export type ClaudePlanResult = { ok: true; view: ClaudePlanView | null; message?: string } | { ok: false; error: string };

/**
 * Settings → AI → Plans on this computer: Claude Code under TechTeam's own config home. Sign in (opens the browser on
 * this computer), sign out, check again, confirm the signed-in account, switch the plan on or off. Switching on needs a
 * plan login on the confirmed account, checked fresh.
 */
export async function claudePlanAction(workspaceId: number, op: unknown): Promise<ClaudePlanResult> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!isClaudePlanOp(op)) return { ok: false, error: "Unknown action." };
  if (!cliAgentsAvailable()) return { ok: false, error: "Plans run only when TechTeam runs on your computer." };
  let message: string | undefined;

  if (op === "sign_in") {
    const started = await startClaudeSignIn();
    if (!started.ok) return started;
    message = "Claude Code opened your browser. Sign in with your personal account, then choose Check again.";
  } else if (op === "sign_out") {
    const out = await signOutClaude();
    if (!out.ok) return out;
    await saveCliSettings(workspace.ownerId, "claude", { enabled: false });
  } else if (op === "disable") {
    await saveCliSettings(workspace.ownerId, "claude", { enabled: false });
  } else if (op === "confirm" || op === "enable") {
    const detection = await detectClaude({ fresh: true });
    const auth = detection.auth;
    if (!detection.binary || detection.problem) return { ok: false, error: detection.problem ?? "Install Claude Code first." };
    if (!auth?.loggedIn || !auth.email) return { ok: false, error: "Sign in to Claude Code first." };
    if (!isPlanLogin(auth)) return { ok: false, error: "Claude Code is signed in without a Claude plan. Sign out and sign in with your Claude account." };
    if (op === "confirm") {
      await saveCliSettings(workspace.ownerId, "claude", { confirmed: { email: auth.email, orgName: auth.orgName } });
    } else {
      const settings = await getCliSettings(workspace.ownerId, "claude");
      if (!accountMatches(auth, settings.confirmed)) return { ok: false, error: `Confirm the account first: Claude Code is signed in as ${describeAccount(auth)}.` };
      await saveCliSettings(workspace.ownerId, "claude", { enabled: true });
    }
  }
  refresh(workspaceId);
  return { ok: true, view: await getClaudePlanView(workspace.ownerId, workspace.id, { fresh: op === "check" }), message };
}

/** Settings → AI → Plans on this computer: what a stage does when the Claude plan runs out. */
export async function savePlanLimitAction(workspaceId: number, policy: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await authorize(workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!isPlanLimitPolicy(policy)) return { ok: false, error: "Choose what happens when your plan runs out." };
  if (!cliAgentsAvailable()) return { ok: false, error: "Plans run only when TechTeam runs on your computer." };
  await saveCliSettings(workspace.ownerId, "claude", { onLimit: policy });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { ok: true };
}
