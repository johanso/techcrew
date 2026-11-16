import { describe, expect, it } from "vitest";

import { AGENT_ROLES } from "@/lib/agent-config";
import { scanAgentRules, trustGrade } from "@/lib/agent-trust";

const defaults = (key: keyof typeof AGENT_ROLES) => {
  const { instructions, skills, monthlyBudgetUsd } = AGENT_ROLES[key].defaults;
  return { key, instructions, skills: [...skills], monthlyBudgetCents: monthlyBudgetUsd * 100 };
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

  it("costs more for riskier skills", () => {
    const base = defaults("developer");
    const withMerge = scanAgentRules({ ...base, skills: [...base.skills, "pr.merge"] });
    expect(withMerge.score).toBeLessThan(scanAgentRules(base).score);
  });

  it("is deterministic", () => {
    const { scannedAt: _a, ...first } = scanAgentRules(defaults("tester"));
    const { scannedAt: _b, ...second } = scanAgentRules(defaults("tester"));
    expect(first).toEqual(second);
  });
});
