import { describe, expect, it } from "vitest";

import { filterSkills, isFilteringSkills, isSkillAgentFilter, matchesSkillQuery, NO_SKILL_FILTERS } from "@/components/skills/skill-filters";
import type { AgentKey } from "@/lib/agent-config";

const skill = (name: string, enabledFor: AgentKey[] = [], description = "") => ({
  name,
  slug: name,
  description,
  origin: "Uploaded by someone",
  type: "practice" as const,
  enabledFor,
});

describe("matchesSkillQuery", () => {
  it("matches every word, in any order, across name and description", () => {
    const s = skill("pr-review", [], "Two passes: repo standards, then the issue.");
    expect(matchesSkillQuery(s, "")).toBe(true);
    expect(matchesSkillQuery(s, "PR review")).toBe(true);
    expect(matchesSkillQuery(s, "issue review")).toBe(true);
    expect(matchesSkillQuery(s, "review security")).toBe(false);
  });

  it("ignores accents and treats hyphens as spaces", () => {
    expect(matchesSkillQuery(skill("interface-craft", [], "Diseño de interfaces"), "diseno")).toBe(true);
    expect(matchesSkillQuery(skill("design-system-first"), "system first")).toBe(true);
  });

  it("finds the type and the origin", () => {
    expect(matchesSkillQuery(skill("x"), "practice")).toBe(true);
    expect(matchesSkillQuery(skill("x"), "uploaded")).toBe(true);
  });
});

describe("filterSkills", () => {
  const skills = [skill("focused-fix", ["developer"]), skill("pr-review", ["reviewer"]), skill("chrome-extensions")];

  it("keeps everything without filters", () => {
    expect(filterSkills(skills, NO_SKILL_FILTERS)).toHaveLength(3);
  });

  it("filters by the agent that has the skill on, or by no agent", () => {
    expect(filterSkills(skills, { query: "", agent: "developer" }).map((s) => s.name)).toEqual(["focused-fix"]);
    expect(filterSkills(skills, { query: "", agent: "none" }).map((s) => s.name)).toEqual(["chrome-extensions"]);
  });

  it("combines the agent and the search", () => {
    expect(filterSkills(skills, { query: "review", agent: "developer" })).toEqual([]);
    expect(filterSkills(skills, { query: "review", agent: "reviewer" }).map((s) => s.name)).toEqual(["pr-review"]);
  });
});

describe("filter state", () => {
  it("knows when it is filtering", () => {
    expect(isFilteringSkills(NO_SKILL_FILTERS)).toBe(false);
    expect(isFilteringSkills({ query: "  ", agent: "all" })).toBe(false);
    expect(isFilteringSkills({ query: "", agent: "tester" })).toBe(true);
  });

  it("validates agent filter values", () => {
    expect(isSkillAgentFilter("all")).toBe(true);
    expect(isSkillAgentFilter("none")).toBe(true);
    expect(isSkillAgentFilter("lead")).toBe(true);
    expect(isSkillAgentFilter("designer")).toBe(false);
  });
});
