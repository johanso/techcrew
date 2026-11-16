import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { agentSkillAssignments, agentSkillFiles, agentSkills, agents, db, type AgentSkillRow } from "@/db";
import { AGENT_KEYS, isAgentKey, isPermissionId, type AgentKey } from "@/lib/agent-config";
import { isSkillLoad, isSkillSource, isSkillType, sortRoles, type SkillScan, type SkillView } from "@/lib/agent-skills-config";
import type { TrustSkillInput } from "@/lib/agent-trust";
import { BUILTIN_SKILLS, builtinSkill, readBuiltinFile } from "@/lib/builtin-skills";
import { cleanSkillPath, parseFrontmatter } from "@/lib/skill-format";
import { formatSearchResults, pageSkillFile, rankSkillFiles, type PromptSkill } from "@/lib/skill-runtime";

/**
 * A workspace's skill library (agent_skills) and which agents use which skill (agent_skill_assignments), plus the
 * runtime side: the skills an agent has switched on, for its prompt and for search_skill / read_skill. Every function
 * takes ids the caller has already authorized (workspace owned by the user, agent of that workspace).
 */

// ── Built-ins ──────────────────────────────────────────────────────────────────

const BUILTIN_SCAN = (): SkillScan => ({ status: "passed", findings: [], reviewedBy: "builtin", model: null, scannedAt: new Date().toISOString() });
const CATALOG_KEY = BUILTIN_SKILLS.map((s) => `${s.slug}@${s.version}`).join(",");
// Workspaces already brought up to this catalog by this server instance (agents are only ever added by
// ensureDefaultAgents, which passes `force` after inserting).
const ensured = new Set<string>();

/**
 * Library rows for the built-in skills and their default assignments by role (sources.json `roles`). Safe to call
 * on every request: rows are upserted by (workspace, slug), assignments only inserted when missing, so a skill the
 * user switched off stays off. Built-ins dropped from the catalog leave the library.
 */
export async function ensureBuiltinSkills(workspaceId: number, force = false) {
  const cacheKey = `${workspaceId}:${CATALOG_KEY}`;
  if (!force && ensured.has(cacheKey)) return;

  const rows = await db
    .select({ id: agentSkills.id, slug: agentSkills.slug, version: agentSkills.version })
    .from(agentSkills)
    .where(and(eq(agentSkills.workspaceId, workspaceId), eq(agentSkills.source, "builtin")));

  const stale = rows.filter((row) => !builtinSkill(row.slug));
  if (stale.length) await db.delete(agentSkills).where(inArray(agentSkills.id, stale.map((row) => row.id)));

  const ids = new Map<string, number>();
  for (const skill of BUILTIN_SKILLS) {
    const existing = rows.find((row) => row.slug === skill.slug);
    const values = {
      name: skill.name,
      description: skill.description,
      type: skill.type,
      load: skill.load,
      origin: skill.origin,
      license: skill.license,
      version: skill.version,
      fileCount: skill.fileCount,
      totalBytes: skill.totalBytes,
      suggestedRoles: skill.roles,
      requiresPermissions: skill.requires,
    };
    if (existing) {
      ids.set(skill.slug, existing.id);
      if (existing.version !== skill.version) {
        await db.update(agentSkills).set({ ...values, scan: BUILTIN_SCAN(), updatedAt: new Date() }).where(eq(agentSkills.id, existing.id));
      }
      continue;
    }
    const [inserted] = await db
      .insert(agentSkills)
      .values({ workspaceId, slug: skill.slug, source: "builtin", scan: BUILTIN_SCAN(), ...values })
      // An uploaded skill can't take a built-in's name (installSkill refuses), so a conflict is a concurrent call.
      .onConflictDoNothing({ target: [agentSkills.workspaceId, agentSkills.slug] })
      .returning({ id: agentSkills.id });
    if (inserted) ids.set(skill.slug, inserted.id);
    else {
      const [row] = await db
        .select({ id: agentSkills.id })
        .from(agentSkills)
        .where(and(eq(agentSkills.workspaceId, workspaceId), eq(agentSkills.slug, skill.slug)));
      if (row) ids.set(skill.slug, row.id);
    }
  }

  const team = await db.select({ id: agents.id, key: agents.key }).from(agents).where(eq(agents.workspaceId, workspaceId));
  const skillIds = [...ids.values()];
  const assigned = skillIds.length
    ? await db
        .select({ agentId: agentSkillAssignments.agentId, skillId: agentSkillAssignments.skillId })
        .from(agentSkillAssignments)
        .where(inArray(agentSkillAssignments.skillId, skillIds))
    : [];
  const missing = BUILTIN_SKILLS.flatMap((skill) => {
    const skillId = ids.get(skill.slug);
    if (!skillId) return [];
    return team
      .filter((agent) => isAgentKey(agent.key) && skill.roles.includes(agent.key))
      .filter((agent) => !assigned.some((a) => a.agentId === agent.id && a.skillId === skillId))
      .map((agent) => ({ agentId: agent.id, skillId, enabled: true }));
  });
  if (missing.length) await db.insert(agentSkillAssignments).values(missing).onConflictDoNothing();
  if (team.length) ensured.add(cacheKey);
}

// ── Library ────────────────────────────────────────────────────────────────────

export function toSkillView(row: AgentSkillRow, enabledFor: AgentKey[]): SkillView {
  const builtin = row.source === "builtin" ? builtinSkill(row.slug) : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: isSkillType(row.type) ? row.type : "technical",
    load: isSkillLoad(row.load) ? row.load : "on_demand",
    source: isSkillSource(row.source) ? row.source : "uploaded",
    origin: row.origin,
    license: row.license,
    url: builtin?.url ?? null,
    version: row.version,
    fileCount: row.fileCount,
    totalBytes: row.totalBytes,
    scan: row.scan ?? null,
    roles: sortRoles(row.suggestedRoles),
    requires: row.requiresPermissions.filter(isPermissionId),
    enabledFor: sortRoles(enabledFor),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The workspace's skills with the agents that have each one switched on: built-ins first, then by name. */
export async function getSkillLibrary(workspaceId: number): Promise<SkillView[]> {
  const [rows, enabled] = await Promise.all([
    db.select().from(agentSkills).where(eq(agentSkills.workspaceId, workspaceId)).orderBy(asc(agentSkills.name)),
    db
      .select({ skillId: agentSkillAssignments.skillId, key: agents.key })
      .from(agentSkillAssignments)
      .innerJoin(agents, eq(agents.id, agentSkillAssignments.agentId))
      .where(and(eq(agents.workspaceId, workspaceId), eq(agentSkillAssignments.enabled, true))),
  ]);
  return rows
    .map((row) => toSkillView(row, enabled.filter((e) => e.skillId === row.id && isAgentKey(e.key)).map((e) => e.key as AgentKey)))
    .sort((a, b) => Number(b.source === "builtin") - Number(a.source === "builtin") || a.name.localeCompare(b.name));
}

export async function getOwnedSkill(workspaceId: number, skillId: number) {
  if (!Number.isSafeInteger(skillId) || skillId <= 0) return null;
  const [row] = await db
    .select()
    .from(agentSkills)
    .where(and(eq(agentSkills.id, skillId), eq(agentSkills.workspaceId, workspaceId)));
  return row ?? null;
}

/** Skills switched on for each agent of the workspace (agent role key → skill ids). */
export async function getEnabledSkillIds(workspaceId: number) {
  const rows = await db
    .select({ key: agents.key, skillId: agentSkillAssignments.skillId })
    .from(agentSkillAssignments)
    .innerJoin(agents, eq(agents.id, agentSkillAssignments.agentId))
    .where(and(eq(agents.workspaceId, workspaceId), eq(agentSkillAssignments.enabled, true)));
  const map = new Map<AgentKey, number[]>(AGENT_KEYS.map((key) => [key, []]));
  for (const row of rows) if (isAgentKey(row.key)) map.get(row.key)!.push(row.skillId);
  return map;
}

// ── One agent's skills ─────────────────────────────────────────────────────────

/** A skill an agent has switched on, as the runtime needs it (not sent to the client). */
export type AgentSkill = { id: number; slug: string; source: AgentSkillRow["source"]; row: AgentSkillRow };

export async function getAgentSkills(agentId: number): Promise<AgentSkill[]> {
  const rows = await db
    .select({ skill: agentSkills })
    .from(agentSkillAssignments)
    .innerJoin(agentSkills, eq(agentSkills.id, agentSkillAssignments.skillId))
    .where(and(eq(agentSkillAssignments.agentId, agentId), eq(agentSkillAssignments.enabled, true)))
    .orderBy(asc(agentSkills.slug));
  return rows.map(({ skill }) => ({ id: skill.id, slug: skill.slug, source: skill.source, row: skill }));
}

/** What the trust scan weighs: each enabled skill's source and scan findings. */
export async function getTrustSkills(agentId: number): Promise<TrustSkillInput[]> {
  return (await getAgentSkills(agentId)).map((s) => ({
    slug: s.slug,
    source: isSkillSource(s.source) ? s.source : "uploaded",
    findings: s.row.scan?.findings ?? [],
  }));
}

async function readSkillFile(skill: AgentSkill, path: string): Promise<string | null> {
  if (skill.source === "builtin") return readBuiltinFile(skill.slug, path);
  const [row] = await db
    .select({ content: agentSkillFiles.content })
    .from(agentSkillFiles)
    .where(and(eq(agentSkillFiles.skillId, skill.id), eq(agentSkillFiles.path, path)));
  return row?.content ?? null;
}

/** The skills block of an agent's system prompt: every enabled skill, with the SKILL.md body of `always` ones. */
export async function promptSkills(skills: AgentSkill[]): Promise<PromptSkill[]> {
  return Promise.all(
    skills.map(async (skill): Promise<PromptSkill> => {
      const load = isSkillLoad(skill.row.load) ? skill.row.load : "on_demand";
      const manifest = load === "always" ? await readSkillFile(skill, "SKILL.md") : null;
      return {
        slug: skill.slug,
        type: isSkillType(skill.row.type) ? skill.row.type : "technical",
        load,
        description: skill.row.description,
        usage: skill.source === "builtin" ? builtinSkill(skill.slug)?.usage || null : null,
        body: manifest === null ? null : parseFrontmatter(manifest).body.trim() || null,
      };
    })
  );
}

async function searchableFiles(skill: AgentSkill) {
  if (skill.source === "builtin") return builtinSkill(skill.slug)?.files ?? [];
  return db
    .select({ path: agentSkillFiles.path, title: agentSkillFiles.title, summary: agentSkillFiles.summary })
    .from(agentSkillFiles)
    .where(eq(agentSkillFiles.skillId, skill.id));
}

function pick(skills: AgentSkill[], name: unknown) {
  return typeof name === "string" ? (skills.find((s) => s.slug === name.trim()) ?? null) : null;
}

const notEnabled = (skills: AgentSkill[], name: unknown) =>
  `Error: no skill named ${JSON.stringify(typeof name === "string" ? name.slice(0, 80) : name)} is enabled for you. Enabled: ${skills.map((s) => s.slug).join(", ") || "none"}.`;

/** search_skill: ranked files of one of the agent's skills. */
export async function searchSkill(skills: AgentSkill[], name: unknown, query: unknown) {
  const skill = pick(skills, name);
  if (!skill) return notEnabled(skills, name);
  const q = typeof query === "string" ? query.trim().slice(0, 200) : "";
  if (!q) return "Error: empty query.";
  return formatSearchResults(skill.slug, q, rankSkillFiles(await searchableFiles(skill), q));
}

/** read_skill: one page of a file of one of the agent's skills. */
export async function readSkill(skills: AgentSkill[], name: unknown, path: unknown, offset: unknown) {
  const skill = pick(skills, name);
  if (!skill) return notEnabled(skills, name);
  const clean = cleanSkillPath(path);
  if (!clean) return "Error: invalid path. Use a path from search_skill, e.g. SKILL.md.";
  const content = await readSkillFile(skill, clean);
  if (content === null) return `Error: ${skill.slug} has no file ${clean}. Use search_skill to find the right path.`;
  return pageSkillFile(skill.slug, clean, content, typeof offset === "number" && Number.isFinite(offset) ? offset : 0);
}
