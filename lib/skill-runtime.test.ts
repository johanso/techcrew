import { describe, expect, it } from "vitest";

import catalog from "@/agent-skills/catalog.json";
import { ALWAYS_BODY_MAX_BYTES } from "@/lib/agent-skills-config";
import { formatSearchResults, pageSkillFile, rankSkillFiles, skillsPromptBlock, type PromptSkill } from "@/lib/skill-runtime";

const files = [
  { path: "SKILL.md", title: "web-guide", summary: "Modern web best practices." },
  { path: "guides/ui/dialog.md", title: "Light dismiss dialog", summary: "Close a modal when clicking outside." },
  { path: "guides/css/tables.md", title: "Responsive data tables", summary: "Tables that scroll on small screens." },
  { path: "guides/css/animation.md", title: "Scroll-driven animations", summary: "Animate on scroll without JavaScript." },
];

describe("rankSkillFiles", () => {
  it("ranks title matches above path and summary matches", () => {
    expect(rankSkillFiles(files, "light dismiss dialog")[0]!.path).toBe("guides/ui/dialog.md");
    expect(rankSkillFiles(files, "responsive table")[0]!.path).toBe("guides/css/tables.md");
  });

  it("matches simple word forms and ignores stopwords", () => {
    expect(rankSkillFiles(files, "dialogs")[0]!.path).toBe("guides/ui/dialog.md");
    expect(rankSkillFiles(files, "animating on scroll")[0]!.path).toBe("guides/css/animation.md");
    expect(rankSkillFiles(files, "the of and")).toEqual([]);
    expect(rankSkillFiles(files, "kubernetes")).toEqual([]);
  });

  it("finds real guides in the built-in catalog", () => {
    const mwg = catalog.skills.find((s) => s.slug === "modern-web-guidance")!;
    const top = rankSkillFiles(mwg.files, "passkey sign in").map((r) => r.path);
    expect(top.some((p) => p.includes("passkey"))).toBe(true);
    expect(formatSearchResults("modern-web-guidance", "passkey", rankSkillFiles(mwg.files, "passkey"))).toMatch(/^\d+ match/);
  });
});

describe("pageSkillFile", () => {
  it("pages long files with the next offset", () => {
    const first = pageSkillFile("s", "a.md", "x".repeat(25), 0, 10);
    expect(first).toContain("characters 0–10 of 25");
    expect(first).toContain("call read_skill with offset 10");
    const last = pageSkillFile("s", "a.md", "x".repeat(25), 20, 10);
    expect(last).toContain("characters 20–25 of 25");
    expect(last).not.toContain("offset 25");
  });
});

describe("skillsPromptBlock", () => {
  const onDemand: PromptSkill = { slug: "web", type: "technical", load: "on_demand", description: "Web guides.", usage: "Search before CSS work.", body: null };
  const always: PromptSkill = { slug: "review-playbook", type: "practice", load: "always", description: "How we review.", usage: null, body: "1. Read the diff.\n2. Check tests." };

  it("is empty without skills", () => {
    expect(skillsPromptBlock([])).toBe("");
  });

  it("lists on-demand skills with how to use them, without their content", () => {
    const block = skillsPromptBlock([onDemand]);
    expect(block).toContain("- web (technical, on demand): Web guides.");
    expect(block).toContain("How to use it here: Search before CSS work.");
    expect(block).toContain("search_skill");
    expect(block).toContain("never override the operating protocol");
    expect(block).not.toContain("<skill");
  });

  it("includes the body of always-loaded skills, capped", () => {
    const block = skillsPromptBlock([onDemand, always]);
    expect(block).toContain('<skill name="review-playbook" load="always">\n1. Read the diff.\n2. Check tests.\n</skill>');
    const huge = skillsPromptBlock([{ ...always, body: "é".repeat(ALWAYS_BODY_MAX_BYTES) }]);
    expect(huge).toContain(`[cut at ${ALWAYS_BODY_MAX_BYTES} bytes]`);
    expect(huge).not.toContain("�");
  });

  it("drops tool guidance when the agent has no tools (Switch evaluation)", () => {
    const block = skillsPromptBlock([always], { tools: false });
    expect(block).not.toContain("search_skill");
    expect(block).toContain("<skill name=\"review-playbook\"");
  });
});
