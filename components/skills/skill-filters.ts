import { isAgentKey, type AgentKey } from "@/lib/agent-config";
import type { SkillView } from "@/lib/agent-skills-config";

/** Library filter by agent: every skill, the ones an agent has on, or the ones no agent uses. */
export type SkillAgentFilter = "all" | "none" | AgentKey;

export type SkillFilters = { query: string; agent: SkillAgentFilter };

export const NO_SKILL_FILTERS: SkillFilters = { query: "", agent: "all" };

export function isSkillAgentFilter(value: unknown): value is SkillAgentFilter {
  return value === "all" || value === "none" || isAgentKey(value);
}

/** Case- and accent-insensitive; hyphens count as spaces, so "pr review" finds "pr-review". */
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query appears in the skill's name, description, origin or type. */
export function matchesSkillQuery(skill: Pick<SkillView, "name" | "slug" | "description" | "origin" | "type">, query: string) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize([skill.name, skill.slug, skill.description, skill.origin, skill.type].join(" "));
  return words.every((word) => haystack.includes(word));
}

export function matchesSkillAgent(skill: Pick<SkillView, "enabledFor">, agent: SkillAgentFilter) {
  if (agent === "all") return true;
  if (agent === "none") return skill.enabledFor.length === 0;
  return skill.enabledFor.includes(agent);
}

export function filterSkills<T extends Pick<SkillView, "name" | "slug" | "description" | "origin" | "type" | "enabledFor">>(skills: T[], filters: SkillFilters) {
  return skills.filter((skill) => matchesSkillAgent(skill, filters.agent) && matchesSkillQuery(skill, filters.query));
}

export function isFilteringSkills(filters: SkillFilters) {
  return filters.query.trim() !== "" || filters.agent !== "all";
}
