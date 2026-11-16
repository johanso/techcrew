import { describe, expect, it } from "vitest";

import { AGENT_ROLES } from "@/lib/agent-config";
import { scanAgentRules, trustGrade } from "@/lib/agent-trust";

const defaults = (key: keyof typeof AGENT_ROLES) => {
  const { instructions, permissions, monthlyBudgetUsd } = AGENT_ROLES[key].defaults;
  return { key, instructions, permissions: [...permissions], monthlyBudgetCents: monthlyBudgetUsd * 100 };
};

describe("trustGrade", () => {
  it("grades by thresholds", () => {
    expect(trustGrade(85).label).toBe("Trusted");
    expect(trustGrade(70).label).toBe("Needs review");
    expect(trustGrade(69).label).toBe("At risk");
  });
});

describe("scanAgentRules", () => {
  it("scores every default agent as trusted", () => {
    for (const key of Object.keys(AGENT_ROLES) as (keyof typeof AGENT_ROLES)[]) {
      const report = scanAgentRules(defaults(key));
      expect(report.score, key).toBeGreaterThanOrEqual(85);
      expect(report.checksPassed).toBeLessThanOrEqual(report.checksTotal);
    }
  });

  it("penalizes short instructions", () => {
    const report = scanAgentRules({ ...defaults("developer"), instructions: "Write code." });
    expect(report.score).toBeLessThan(scanAgentRules(defaults("developer")).score);
    expect(report.findings.some((f) => f.title.includes("too short"))).toBe(true);
  });

  it("costs more for riskier permissions", () => {
    const base = defaults("developer");
    const withMerge = scanAgentRules({ ...base, permissions: [...base.permissions, "pr.merge"] });
    expect(withMerge.score).toBeLessThan(scanAgentRules(base).score);
  });

  it("is deterministic", () => {
    const { scannedAt: _a, ...first } = scanAgentRules(defaults("tester"));
    const { scannedAt: _b, ...second } = scanAgentRules(defaults("tester"));
    expect(first).toEqual(second);
  });
});

describe("scanAgentRules with skills", () => {
  const finding = (severity: "high" | "medium") => ({ id: `x:${severity}`, severity, title: `A ${severity} finding`, detail: "", path: "SKILL.md:1", source: "rules" as const });

  it("counts the scan findings of enabled uploaded skills", () => {
    const base = defaults("developer");
    const clean = scanAgentRules({ ...base, skills: [{ slug: "clean", source: "uploaded", findings: [] }] });
    const warned = scanAgentRules({ ...base, skills: [{ slug: "risky", source: "uploaded", findings: [finding("medium"), finding("high")] }] });
    expect(clean.score).toBe(scanAgentRules(base).score);
    expect(clean.checksTotal).toBe(scanAgentRules(base).checksTotal + 1);
    expect(warned.score).toBeLessThan(clean.score);
    expect(warned.findings.find((f) => f.id === "skill-risky")).toMatchObject({ severity: "high", title: expect.stringContaining("risky") });
  });

  it("treats built-ins as reviewed", () => {
    const base = defaults("reviewer");
    const report = scanAgentRules({ ...base, skills: [{ slug: "modern-web-guidance", source: "builtin", findings: [finding("high")] }] });
    expect(report).toMatchObject({ score: scanAgentRules(base).score, checksTotal: scanAgentRules(base).checksTotal });
  });
});
