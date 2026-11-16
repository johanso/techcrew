import "server-only";

import { and, eq } from "drizzle-orm";

import { agentSkillAssignments, agentSkillFiles, agentSkills, agents, db, type AgentRow, type AgentSkillRow, type User, type Workspace } from "@/db";
import { AGENT_ROLES, isAgentKey, type AgentKey, type PermissionId } from "@/lib/agent-config";
import { configAIErrorMessage, getWorkspaceConfigAI, reviewSkillWithAI } from "@/lib/agent-ai";
import {
  ALWAYS_BODY_MAX_BYTES,
  SKILL_SOURCE_META,
  formatBytes,
  isSkillLoad,
  isSkillType,
  skillMetadata,
  skillScanStatus,
  sortRoles,
  type SkillLoad,
  type SkillScan,
  type SkillScanFinding,
  type SkillType,
} from "@/lib/agent-skills-config";
import { getOwnedSkill } from "@/lib/agent-skills";
import { ensureDefaultAgents, getAgentRow, logAgentActivity, refreshRuleTrust } from "@/lib/agents";
import { builtinSkill } from "@/lib/builtin-skills";
import { decrypt, encrypt } from "@/lib/crypto";
import { readSkillPackage, type SkillPackage } from "@/lib/skill-package";
import { scanSkillFiles, sortSkillFindings } from "@/lib/skill-scan";

/**
 * Changing a workspace's skill library: uploading (inspect → confirm → install), new versions, assignments and
 * deletes. Every change that alters what an agent reads re-runs that agent's rule-based trust scan and is logged in
 * its activity. Callers have authorized the workspace; skill ids are re-checked against it here.
 */

// ── Upload: inspect ────────────────────────────────────────────────────────────

export type UploadPreview = {
  /** Sealed (AES-GCM) proof of what was inspected: version, scan findings, proposal. Sent back with the confirm. */
  token: string;
  name: string;
  description: string;
  license: string | null;
  fileCount: number;
  totalBytes: number;
  ignored: string[];
  status: "passed" | "warned";
  findings: SkillScanFinding[];
  reviewedBy: "rules" | "ai";
  /** Why the AI review didn't run or failed (no key, provider error); the rules ran anyway. */
  aiNotice: string | null;
  type: SkillType;
  load: SkillLoad;
  roles: AgentKey[];
  /** Where type, load and roles came from. */
  classifiedBy: "metadata" | "ai" | "default";
  requires: PermissionId[];
  /** SKILL.md body size: an `always` skill must stay within ALWAYS_BODY_MAX_BYTES. */
  bodyBytes: number;
  replacing: { id: number; name: string } | null;
};

export type InspectResult =
  | { ok: true; preview: UploadPreview }
  | { ok: false; error: string; blocked?: { findings: SkillScanFinding[]; reviewedBy: "rules" | "ai" } };

type Seal = {
  w: number;
  v: string;
  n: string;
  r: number | null;
  /** AI findings (the rules re-run on install). */
  f: SkillScanFinding[];
  by: "rules" | "ai";
  m: string | null;
  /** Proposed roles: kept as the skill's suggested roles. */
  p: AgentKey[];
  exp: number;
};

const SEAL_TTL_MS = 30 * 60_000;

function seal(value: Omit<Seal, "exp">) {
  return encrypt(JSON.stringify({ ...value, exp: Date.now() + SEAL_TTL_MS }));
}

function unseal(token: unknown): Seal | null {
  if (typeof token !== "string" || token.length > 20_000) return null;
  try {
    const value = JSON.parse(decrypt(token)) as Seal;
    return value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}

const bodyBytes = (pkg: SkillPackage) => Buffer.byteLength(pkg.manifest.body);

/** Name rules beyond the format: unique in the workspace, not a built-in's, the same as the skill a new version replaces. */
async function checkName(workspaceId: number, name: string, replaceId: number | null) {
  if (replaceId !== null) {
    const existing = await getOwnedSkill(workspaceId, replaceId);
    if (!existing || existing.source !== "uploaded") return { error: "That skill can't be replaced. Only uploaded skills get new versions." } as const;
    if (existing.slug !== name) return { error: `The new version must keep the name “${existing.slug}” (this one is “${name}”).` } as const;
    return { existing } as const;
  }
  if (builtinSkill(name)) return { error: `“${name}” is the name of a built-in skill. Rename yours in its SKILL.md frontmatter.` } as const;
  const [taken] = await db
    .select({ id: agentSkills.id })
    .from(agentSkills)
    .where(and(eq(agentSkills.workspaceId, workspaceId), eq(agentSkills.slug, name)));
  if (taken) return { error: `A skill named “${name}” is already installed. Upload a new version from its row instead.` } as const;
  return { existing: null } as const;
}

/**
 * Reads, validates and scans an upload without installing anything. Rules first (free); a critical finding blocks
 * before any model call. Then, with a provider key, one AI call reviews it and proposes type, load and roles; its
 * cost is logged on the Security agent (it's a security review), since no agent owns the skill yet.
 */
export async function inspectSkillUpload(input: { workspace: Workspace; fileName: string; bytes: Buffer; replaceId: number | null }): Promise<InspectResult> {
  const read = readSkillPackage(input.fileName, input.bytes);
  if (!read.ok) return read;
  const { pkg } = read;
  const { name, description } = pkg.manifest;
  const named = await checkName(input.workspace.id, name, input.replaceId);
  if ("error" in named) return { ok: false, error: named.error! };
  if (named.existing?.version === pkg.version) return { ok: false, error: "This is the version that's already installed." };

  const rules = scanSkillFiles(pkg.files);
  if (skillScanStatus(rules) === "blocked") {
    return { ok: false, error: `${name} wasn't installed: the security scan found critical problems.`, blocked: { findings: rules, reviewedBy: "rules" } };
  }

  const meta = skillMetadata(pkg.manifest.metadata);
  let review: Awaited<ReturnType<typeof reviewSkillWithAI>> | null = null;
  let aiNotice: string | null = null;
  const ai = await getWorkspaceConfigAI(input.workspace);
  if (!ai) {
    aiNotice = "No AI provider key, so only the rule-based scan ran. Add a key in AI providers for an AI review too.";
  } else {
    try {
      review = await reviewSkillWithAI({ ai, name, description, files: pkg.files });
      await logReviewCost(input.workspace.id, name, review.findings.length, review.costMicros);
    } catch (error) {
      console.error("[skills] AI review failed", error);
      aiNotice = `${configAIErrorMessage(ai, error)} Only the rule-based scan ran.`;
    }
  }

  const findings = sortSkillFindings([...rules, ...(review?.findings ?? [])]);
  const reviewedBy = review ? "ai" : "rules";
  const status = skillScanStatus(findings);
  if (status === "blocked") {
    return { ok: false, error: `${name} wasn't installed: the security review found critical problems.`, blocked: { findings, reviewedBy } };
  }

  const fromMeta = meta.type !== null && meta.load !== null && meta.roles !== null;
  const roles = sortRoles(meta.roles ?? review?.roles ?? []);
  const proposedLoad = meta.load ?? review?.load ?? "on_demand";
  const preview: UploadPreview = {
    token: seal({ w: input.workspace.id, v: pkg.version, n: name, r: input.replaceId, f: review?.findings ?? [], by: reviewedBy, m: review?.model ?? null, p: roles }),
    name,
    description,
    license: pkg.manifest.license,
    fileCount: pkg.files.length,
    totalBytes: pkg.totalBytes,
    ignored: pkg.ignored.slice(0, 50),
    status,
    findings,
    reviewedBy,
    aiNotice,
    type: meta.type ?? review?.type ?? "practice",
    // A playbook too long to ride in every prompt is offered as on demand.
    load: proposedLoad === "always" && bodyBytes(pkg) > ALWAYS_BODY_MAX_BYTES ? "on_demand" : proposedLoad,
    roles,
    classifiedBy: fromMeta ? "metadata" : review ? "ai" : "default",
    requires: meta.requires,
    bodyBytes: bodyBytes(pkg),
    replacing: named.existing ? { id: named.existing.id, name: named.existing.name } : null,
  };
  return { ok: true, preview };
}

async function logReviewCost(workspaceId: number, name: string, findings: number, costMicros: number) {
  await ensureDefaultAgents(workspaceId);
  const security = await getAgentRow(workspaceId, "security");
  if (!security) return;
  await logAgentActivity({
    workspaceId,
    agentId: security.id,
    kind: "scan",
    title: `Reviewed skill upload: ${name}`,
    detail: findings ? `${findings} AI finding${findings === 1 ? "" : "s"} before install.` : "No AI findings before install.",
    costMicros,
  });
}

// ── Upload: install ────────────────────────────────────────────────────────────

export type InstallChoices = { type: unknown; load: unknown; roles: unknown };

/**
 * Installs an inspected upload. The file is read again and must be the version the seal names; the rules re-run (the
 * AI findings come from the seal, so the review isn't paid twice). Then the files are stored, the chosen agents get
 * it switched on (everyone else off) and their trust scans re-run.
 */
export async function installSkillUpload(input: {
  workspace: Workspace;
  user: Pick<User, "id" | "name" | "email">;
  fileName: string;
  bytes: Buffer;
  token: unknown;
  replaceId: number | null;
  choices: InstallChoices;
}): Promise<{ ok: true; skillId: number; name: string } | { ok: false; error: string }> {
  const sealed = unseal(input.token);
  if (!sealed || sealed.w !== input.workspace.id || sealed.r !== input.replaceId) return { ok: false, error: "This upload expired. Choose the file again." };
  const read = readSkillPackage(input.fileName, input.bytes);
  if (!read.ok) return read;
  const { pkg } = read;
  if (pkg.version !== sealed.v || pkg.manifest.name !== sealed.n) return { ok: false, error: "The file changed since it was checked. Choose it again." };

  const { type, load } = input.choices;
  if (!isSkillType(type) || !isSkillLoad(load)) return { ok: false, error: "Choose a type and how the skill loads." };
  const roles = Array.isArray(input.choices.roles) ? sortRoles(input.choices.roles.filter(isAgentKey)) : [];
  if (load === "always" && bodyBytes(pkg) > ALWAYS_BODY_MAX_BYTES) {
    return {
      ok: false,
      error: `SKILL.md is ${formatBytes(bodyBytes(pkg))}, too long to load into every prompt (limit ${formatBytes(ALWAYS_BODY_MAX_BYTES)}). Install it as on demand, or shorten it.`,
    };
  }

  const named = await checkName(input.workspace.id, pkg.manifest.name, input.replaceId);
  if ("error" in named) return { ok: false, error: named.error! };
  const findings = sortSkillFindings([...scanSkillFiles(pkg.files), ...sealed.f]);
  const status = skillScanStatus(findings);
  if (status === "blocked") return { ok: false, error: "The security scan found critical problems; the skill wasn't installed." };
  const scan: SkillScan = { status, findings, reviewedBy: sealed.by, model: sealed.m, scannedAt: new Date().toISOString() };
  const meta = skillMetadata(pkg.manifest.metadata);
  const values = {
    name: pkg.manifest.name,
    description: pkg.manifest.description,
    type,
    load,
    license: pkg.manifest.license,
    version: pkg.version,
    fileCount: pkg.files.length,
    totalBytes: pkg.totalBytes,
    scan,
    suggestedRoles: sealed.p.length ? sealed.p : roles,
    requiresPermissions: meta.requires,
  };

  let skill: AgentSkillRow;
  try {
    skill = await db.transaction(async (tx) => {
      let row: AgentSkillRow | undefined;
      if (named.existing) {
        [row] = await tx
          .update(agentSkills)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(agentSkills.id, named.existing.id))
          .returning();
        await tx.delete(agentSkillFiles).where(eq(agentSkillFiles.skillId, named.existing.id));
      } else {
        [row] = await tx
          .insert(agentSkills)
          .values({
            ...values,
            workspaceId: input.workspace.id,
            slug: pkg.manifest.name,
            source: "uploaded",
            origin: `Uploaded by ${input.user.name || input.user.email}`,
            createdById: input.user.id,
          })
          .returning();
      }
      if (!row) throw new Error("Skill row missing after write.");
      await tx.insert(agentSkillFiles).values(
        pkg.files.map((f) => ({ skillId: row.id, path: f.path, content: f.content, title: f.title, summary: f.summary, size: f.size }))
      );
      return row;
    });
  } catch (error) {
    console.error("[skills] install failed", error);
    return { ok: false, error: "We couldn't install the skill. Please try again." };
  }

  // A new version changes what every agent using it reads: rescan them even when their assignment stays.
  await setSkillAssignments(input.workspace.id, skill, roles, { rescanAll: named.existing !== null });
  return { ok: true, skillId: skill.id, name: skill.name };
}

// ── Assignments ────────────────────────────────────────────────────────────────

async function applyAssignment(agent: AgentRow, skill: AgentSkillRow, enabled: boolean) {
  const now = new Date();
  await db
    .insert(agentSkillAssignments)
    .values({ agentId: agent.id, skillId: skill.id, enabled })
    .onConflictDoUpdate({ target: [agentSkillAssignments.agentId, agentSkillAssignments.skillId], set: { enabled, updatedAt: now } });
  // A configuration change: a Switch report older than this describes the agent without (or with) the skill.
  await db.update(agents).set({ updatedAt: now }).where(eq(agents.id, agent.id));
  const before = agent.trustScore;
  const after = await refreshRuleTrust(agent);
  const source = SKILL_SOURCE_META[skill.source as keyof typeof SKILL_SOURCE_META]?.label ?? "Uploaded";
  await logAgentActivity({
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    kind: "configured",
    title: enabled ? `Skill switched on: ${skill.name}` : `Skill switched off: ${skill.name}`,
    detail: `${source} skill.${after !== null && before !== null && after !== before ? ` Trust score ${before} → ${after}.` : ""}`,
  });
}

/** AI Team → Configure → Skills: one agent's switch for one skill. */
export async function setAgentSkill(workspaceId: number, key: AgentKey, skillId: number, enabled: boolean) {
  const [agent, skill] = await Promise.all([getAgentRow(workspaceId, key), getOwnedSkill(workspaceId, skillId)]);
  if (!agent || !skill) return { ok: false as const, error: "Skill not found." };
  const [current] = await db
    .select({ enabled: agentSkillAssignments.enabled })
    .from(agentSkillAssignments)
    .where(and(eq(agentSkillAssignments.agentId, agent.id), eq(agentSkillAssignments.skillId, skill.id)));
  if ((current?.enabled ?? false) !== enabled) await applyAssignment(agent, skill, enabled);
  return { ok: true as const };
}

/**
 * Settings → Agent skills: exactly `keys` have the skill switched on. Agents whose switch changes are logged and
 * rescanned; with `rescanAll` (new version) every agent that keeps it is rescanned too.
 */
export async function setSkillAssignments(workspaceId: number, skill: AgentSkillRow, keys: AgentKey[], { rescanAll = false } = {}) {
  await ensureDefaultAgents(workspaceId);
  const [team, current] = await Promise.all([
    db.select().from(agents).where(eq(agents.workspaceId, workspaceId)),
    db.select().from(agentSkillAssignments).where(eq(agentSkillAssignments.skillId, skill.id)),
  ]);
  let changed = 0;
  for (const agent of team) {
    if (!isAgentKey(agent.key)) continue;
    const want = keys.includes(agent.key);
    const have = current.find((a) => a.agentId === agent.id)?.enabled ?? false;
    if (want !== have) {
      await applyAssignment(agent, skill, want);
      changed++;
    } else if (want && rescanAll) {
      await refreshRuleTrust(agent);
      await logAgentActivity({
        workspaceId,
        agentId: agent.id,
        kind: "configured",
        title: `Skill updated: ${skill.name}`,
        detail: `New version ${skill.version}.`,
      });
    }
  }
  return changed;
}

/** Deletes an uploaded skill (built-ins can only be switched off). Agents that used it are rescanned. */
export async function deleteUploadedSkill(workspaceId: number, skillId: number) {
  const skill = await getOwnedSkill(workspaceId, skillId);
  if (!skill) return { ok: false as const, error: "Skill not found." };
  if (skill.source !== "uploaded") return { ok: false as const, error: "Built-in skills can't be deleted. Switch them off for every agent instead." };
  const users = await db
    .select({ agent: agents })
    .from(agentSkillAssignments)
    .innerJoin(agents, eq(agents.id, agentSkillAssignments.agentId))
    .where(and(eq(agentSkillAssignments.skillId, skill.id), eq(agentSkillAssignments.enabled, true)));
  await db.delete(agentSkills).where(eq(agentSkills.id, skill.id));
  for (const { agent } of users) {
    await refreshRuleTrust(agent);
    await logAgentActivity({
      workspaceId,
      agentId: agent.id,
      kind: "configured",
      title: `Skill removed: ${skill.name}`,
      detail: "Deleted from the workspace's skill library.",
    });
  }
  return { ok: true as const, name: skill.name, agents: users.map(({ agent }) => (isAgentKey(agent.key) ? AGENT_ROLES[agent.key].name : agent.key)) };
}
