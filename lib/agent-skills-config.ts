import { AGENT_KEYS, isAgentKey, isPermissionId, type AgentKey, type PermissionId } from "@/lib/agent-config";

/**
 * Agent skills vocabulary shared by server and client. A skill is a knowledge pack in the Agent Skills format (a
 * folder with SKILL.md plus optional reference .md files) that agents read while they work. Skills are never
 * executed: agents only search and read them (search_skill, read_skill). Not to be confused with permissions
 * (PERMISSIONS in lib/agent-config.ts), which decide what an agent may do. No React, no DB: safe to import anywhere.
 */

/** technical: how to use a technology well. practice: how to do a kind of work well. */
export const SKILL_TYPES = ["technical", "practice"] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** always: the SKILL.md body goes into the agent's prompt. on_demand: the agent searches and reads it when needed. */
export const SKILL_LOADS = ["always", "on_demand"] as const;
export type SkillLoad = (typeof SKILL_LOADS)[number];

/** builtin: vendored in this repository (agent-skills/). uploaded: by the workspace owner. project: the linked repo (later). */
export const SKILL_SOURCES = ["builtin", "uploaded", "project"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export const SKILL_TYPE_META: Record<SkillType, { label: string; hint: string }> = {
  technical: { label: "Technical", hint: "How to use a technology well" },
  practice: { label: "Practice", hint: "How to do a kind of work well" },
};

export const SKILL_LOAD_META: Record<SkillLoad, { label: string; hint: string }> = {
  always: { label: "Always loaded", hint: "Its playbook is part of every prompt" },
  on_demand: { label: "On demand", hint: "Searched and read when the task needs it" },
};

export const SKILL_SOURCE_META: Record<SkillSource, { label: string }> = {
  builtin: { label: "Built-in" },
  uploaded: { label: "Uploaded" },
  project: { label: "Project" },
};

export const isSkillType = (value: unknown): value is SkillType => SKILL_TYPES.includes(value as SkillType);
export const isSkillLoad = (value: unknown): value is SkillLoad => SKILL_LOADS.includes(value as SkillLoad);
export const isSkillSource = (value: unknown): value is SkillSource => SKILL_SOURCES.includes(value as SkillSource);

// ── Limits (validated on the server, mirrored in the upload form) ──────────────

/** Largest .zip (or .md) a user may upload. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Largest total of the text files kept from an upload, uncompressed. */
export const UPLOAD_TEXT_MAX_BYTES = 3 * 1024 * 1024;
/** Most files kept from an upload. */
export const UPLOAD_FILES_MAX = 300;
/** Largest SKILL.md body of an `always` skill: it rides in every prompt of the agents that have it. */
export const ALWAYS_BODY_MAX_BYTES = 8 * 1024;
/** Most characters read_skill returns per call; the agent pages through longer files with `offset`. */
export const READ_SKILL_MAX_CHARS = 30_000;
/** Matches search_skill returns. */
export const SEARCH_SKILL_RESULTS = 8;
/** Agent Skills spec: name ≤ 64 lowercase letters, digits and single hyphens; description ≤ 1024 characters. */
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** Only these files are kept from an upload (everything else is listed as ignored). */
export const SKILL_TEXT_EXTENSIONS = [".md", ".txt"] as const;

/**
 * Optional frontmatter metadata TechTeam reads (Agent Skills `metadata` is a string map). Lists are comma separated.
 *   metadata:
 *     techteam-type: practice            # technical | practice
 *     techteam-load: always              # always | on_demand
 *     techteam-roles: tester, reviewer   # agents it fits (analyst, developer, reviewer, security, lead, tester)
 *     techteam-requires: tests.write     # permissions the skill assumes (a warning when the agent lacks one)
 */
export const SKILL_METADATA_KEYS = {
  type: "techteam-type",
  load: "techteam-load",
  roles: "techteam-roles",
  requires: "techteam-requires",
} as const;

// ── Scan ───────────────────────────────────────────────────────────────────────

export type SkillScanSeverity = "critical" | "high" | "medium" | "low";

export type SkillScanFinding = {
  id: string;
  severity: SkillScanSeverity;
  title: string;
  detail: string;
  /** File inside the skill, when the finding is tied to one. */
  path: string | null;
  source: "rules" | "ai";
};

/**
 * The security scan stored on agent_skills.scan. blocked: a critical finding, never installed (only ever returned
 * to the uploader). warned: installed, findings shown and counted in the agents' trust scans. passed: nothing found.
 */
export type SkillScan = {
  status: "passed" | "warned" | "blocked";
  findings: SkillScanFinding[];
  /** builtin: vendored by pull request (reviewed in code review); rules / ai: how an upload was checked. */
  reviewedBy: "builtin" | "rules" | "ai";
  model: string | null;
  scannedAt: string;
};

export const SKILL_SCAN_SEVERITIES: SkillScanSeverity[] = ["critical", "high", "medium", "low"];

/** passed / warned / blocked from the findings: any critical blocks, anything else warns. */
export function skillScanStatus(findings: Pick<SkillScanFinding, "severity">[]): SkillScan["status"] {
  if (findings.some((f) => f.severity === "critical")) return "blocked";
  return findings.length ? "warned" : "passed";
}

// ── Metadata ───────────────────────────────────────────────────────────────────

const splitList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase());
  if (typeof value !== "string") return [];
  return value
    .split(/[,\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
};

export type SkillClassification = { type: SkillType | null; load: SkillLoad | null; roles: AgentKey[] | null; requires: PermissionId[] };

/** TechTeam's keys from a skill's frontmatter `metadata` (null where absent or invalid: the AI or the user decides). */
export function skillMetadata(metadata: unknown): SkillClassification {
  const map = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const type = typeof map[SKILL_METADATA_KEYS.type] === "string" ? String(map[SKILL_METADATA_KEYS.type]).trim().toLowerCase() : null;
  const rawLoad = typeof map[SKILL_METADATA_KEYS.load] === "string" ? String(map[SKILL_METADATA_KEYS.load]).trim().toLowerCase() : null;
  const load = rawLoad?.replace(/[-\s]/g, "_") ?? null;
  const roles = SKILL_METADATA_KEYS.roles in map ? [...new Set(splitList(map[SKILL_METADATA_KEYS.roles]).filter(isAgentKey))] : null;
  return {
    type: isSkillType(type) ? type : null,
    load: isSkillLoad(load) ? load : null,
    roles,
    requires: [...new Set(splitList(map[SKILL_METADATA_KEYS.requires]).filter(isPermissionId))],
  };
}

/** Agents a skill fits, in team order (for "Recommended for …" and the upload's pre-checked boxes). */
export function sortRoles(roles: readonly string[]): AgentKey[] {
  return AGENT_KEYS.filter((key) => roles.includes(key));
}

/** Default assignment of a built-in skill: enabled for the roles its source lists, nobody else. */
export function defaultAssignment(roles: readonly string[], agent: AgentKey) {
  return roles.includes(agent);
}

// ── Views ──────────────────────────────────────────────────────────────────────

/** One skill of the workspace library, as Settings and the configure dialog show it. */
export type SkillView = {
  id: number;
  slug: string;
  name: string;
  description: string;
  type: SkillType;
  load: SkillLoad;
  source: SkillSource;
  origin: string;
  license: string | null;
  url: string | null;
  version: string;
  fileCount: number;
  totalBytes: number;
  scan: SkillScan | null;
  roles: AgentKey[];
  requires: PermissionId[];
  /** Agents that have it switched on. */
  enabledFor: AgentKey[];
  updatedAt: string;
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
