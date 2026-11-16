import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/agent-config";
import {
  AGENT_STAGE,
  AGENT_STAGES,
  ANSWER_MAX,
  MERGE_MODES,
  PHASE_META,
  RISK_LEVELS,
  RUN_STAGES,
  STAGE_META,
  applyRiskFloor,
  mergeDecision,
  parseAnswer,
  parseMergeMode,
  riskFloor,
  workingAgents,
  type LeadDecision,
  type SecurityFinding,
  type SecurityReport,
} from "@/lib/agent-run-config";

describe("parseAnswer", () => {
  it("trims and accepts a normal answer", () => {
    expect(parseAnswer("  It's a static site: open index.html.  ")).toEqual({ ok: true, value: "It's a static site: open index.html." });
  });

  it("rejects empty, blank and non-string input", () => {
    for (const raw of ["", "   \n", undefined, null, 42, { text: "hi" }]) {
      expect(parseAnswer(raw).ok).toBe(false);
    }
  });

  it("enforces the length limit after trimming", () => {
    expect(parseAnswer(`  ${"a".repeat(ANSWER_MAX)}  `).ok).toBe(true);
    expect(parseAnswer("a".repeat(ANSWER_MAX + 1)).ok).toBe(false);
  });
});

describe("phases and agent stages", () => {
  it("gives every agent exactly one stage, in a phase that lists it", () => {
    for (const agent of AGENT_KEYS) {
      const stages = AGENT_STAGES.filter((stage) => STAGE_META[stage].agent === agent);
      expect(stages, agent).toEqual([AGENT_STAGE[agent]]);
      expect(PHASE_META[STAGE_META[AGENT_STAGE[agent]].phase].agents).toContain(agent);
    }
  });

  it("lists every phase agent's stage under that phase", () => {
    for (const phase of RUN_STAGES) {
      for (const agent of PHASE_META[phase].agents) expect(STAGE_META[AGENT_STAGE[agent]].phase).toBe(phase);
    }
  });

  it("runs Reviewer and Security in parallel, the Lead alone, and merges without an agent", () => {
    expect(PHASE_META.review.agents).toEqual(["reviewer", "security"]);
    expect(PHASE_META.approval.agents).toEqual(["lead"]);
    expect(PHASE_META.merge.agents).toEqual([]);
    // The board keeps six columns: approval holds the card in In Review.
    expect(PHASE_META.approval.column).toBe("in_review");
  });
});

describe("workingAgents", () => {
  it("has both reviewers working until each stage ends", () => {
    expect(workingAgents("review", [])).toEqual(["reviewer", "security"]);
    expect(workingAgents("review", ["security"])).toEqual(["reviewer"]);
    expect(workingAgents("review", ["review", "security"])).toEqual([]);
  });

  it("ignores stages of other phases and has nobody working on a merge", () => {
    expect(workingAgents("approval", ["review", "security"])).toEqual(["lead"]);
    expect(workingAgents("merge", [])).toEqual([]);
  });
});

const finding = (severity: SecurityFinding["severity"]): SecurityFinding => ({ severity, category: "injection", path: "src/a.ts", detail: "…" });
const report = (...severities: SecurityFinding["severity"][]): SecurityReport => ({
  verdict: severities.length ? "issues" : "pass",
  summary: "",
  findings: severities.map(finding),
});

describe("riskFloor", () => {
  it("is low for a small change with a clean security report", () => {
    expect(riskFloor(report(), { paths: ["src/footer.css"], changedLines: 4 })).toEqual({ risk: "low", reasons: [] });
    expect(riskFloor(report("low"), null).risk).toBe("low");
  });

  it("follows Security's worst finding", () => {
    expect(riskFloor(report("low", "medium"), null).risk).toBe("medium");
    expect(riskFloor(report("high"), null).risk).toBe("high");
    expect(riskFloor(report("critical", "medium"), null).risk).toBe("high");
  });

  it("raises sensitive paths to medium", () => {
    for (const path of ["package.json", "web/package-lock.json", "drizzle/0005_x.sql", "lib/auth.ts", "app/(auth)/sign-in/page.tsx", ".github/workflows/ci.yml", "Dockerfile", "infra/main.tf"]) {
      expect(riskFloor(null, { paths: [path], changedLines: 3 }).risk, path).toBe("medium");
    }
    expect(riskFloor(null, { paths: ["lib/session-cache.ts"], changedLines: 3 }).risk).toBe("medium");
    expect(riskFloor(null, { paths: ["README.md", "src/footer.css", "src/author-card.css", "docs/tokenizer-notes.md"], changedLines: 3 }).risk).toBe("low");
  });

  it("raises large changes to medium", () => {
    expect(riskFloor(null, { paths: ["a.ts"], changedLines: 401 }).risk).toBe("medium");
    expect(riskFloor(null, { paths: Array.from({ length: 11 }, (_, i) => `src/${i}.ts`), changedLines: 22 }).risk).toBe("medium");
  });

  it("never lowers a high floor for paths, and keeps every reason once", () => {
    const floor = riskFloor(report("high"), { paths: ["package.json", "yarn.lock"], changedLines: 3 });
    expect(floor.risk).toBe("high");
    expect(floor.reasons).toHaveLength(2);
  });
});

describe("applyRiskFloor", () => {
  const decision = (risk: LeadDecision["risk"]): LeadDecision => ({
    decision: "approve",
    risk,
    riskReasons: ["Lead's reason."],
    summary: "",
    requiredChanges: [],
  });

  it("raises the Lead's rating to the floor, floor's reasons first", () => {
    expect(applyRiskFloor(decision("low"), { risk: "medium", reasons: ["Changes dependencies."] })).toMatchObject({
      risk: "medium",
      riskReasons: ["Changes dependencies.", "Lead's reason."],
    });
  });

  it("keeps a higher rating from the Lead", () => {
    expect(applyRiskFloor(decision("high"), { risk: "medium", reasons: [] }).risk).toBe("high");
    expect(applyRiskFloor(decision("medium"), { risk: "low", reasons: [] })).toMatchObject({ risk: "medium", riskReasons: ["Lead's reason."] });
  });
});

describe("merging", () => {
  it("decides per mode and risk", () => {
    const table = Object.fromEntries(MERGE_MODES.map((mode) => [mode, RISK_LEVELS.map((risk) => mergeDecision(mode, risk))]));
    expect(table).toEqual({
      manual: ["wait", "wait", "wait"],
      auto_low_risk: ["auto", "wait", "wait"],
      auto: ["auto", "auto", "auto"],
    });
  });

  it("reads unknown stored modes as manual", () => {
    expect(parseMergeMode("auto_low_risk")).toBe("auto_low_risk");
    for (const raw of [null, "", "true", "AUTO", 1]) expect(parseMergeMode(raw)).toBe("manual");
  });
});
