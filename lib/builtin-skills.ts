import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import catalog from "@/agent-skills/catalog.json";
import { isAgentKey, isPermissionId, type AgentKey, type PermissionId } from "@/lib/agent-config";
import { isSkillLoad, isSkillType, type SkillLoad, type SkillType } from "@/lib/agent-skills-config";
import { cleanSkillPath } from "@/lib/skill-format";

/**
 * Built-in skills: vendored in agent-skills/<slug>/ by `npm run skills:sync` (reviewed in a pull request), listed in
 * the generated agent-skills/catalog.json. Metadata and search data come from the catalog (bundled); file contents
 * are read from disk (next.config.ts traces agent-skills/ into the functions that read it). Never fetched at runtime.
 */

export type BuiltinSkill = {
  slug: string;
  name: string;
  description: string;
  type: SkillType;
  load: SkillLoad;
  roles: AgentKey[];
  requires: PermissionId[];
  license: string;
  origin: string;
  url: string;
  usage: string;
  version: string;
  fileCount: number;
  totalBytes: number;
  files: { path: string; title: string; summary: string; bytes: number }[];
};

export const BUILTIN_SKILLS: BuiltinSkill[] = catalog.skills.map((skill) => ({
  ...skill,
  type: isSkillType(skill.type) ? skill.type : "technical",
  load: isSkillLoad(skill.load) ? skill.load : "on_demand",
  roles: skill.roles.filter(isAgentKey),
  requires: skill.requires.filter(isPermissionId),
}));

export function builtinSkill(slug: string) {
  return BUILTIN_SKILLS.find((skill) => skill.slug === slug) ?? null;
}

const SKILLS_ROOT = path.join(process.cwd(), "agent-skills");

/** A built-in file's text, or null. Only files listed in the catalog can be read, so a path can't leave the folder. */
export async function readBuiltinFile(slug: string, file: string) {
  const skill = builtinSkill(slug);
  const clean = cleanSkillPath(file);
  if (!skill || !clean || !skill.files.some((f) => f.path === clean)) return null;
  try {
    return await readFile(path.join(SKILLS_ROOT, skill.slug, clean), "utf8");
  } catch (error) {
    console.error(`[skills] built-in file missing: ${skill.slug}/${clean}`, error);
    return null;
  }
}
