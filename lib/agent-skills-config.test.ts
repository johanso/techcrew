import { describe, expect, it } from "vitest";

import catalog from "@/agent-skills/catalog.json";
import sources from "@/agent-skills/sources.json";
import { AGENT_KEYS } from "@/lib/agent-config";
import { defaultAssignment, formatBytes, skillMetadata, skillScanStatus, sortRoles } from "@/lib/agent-skills-config";

describe("skillMetadata", () => {
  it("reads TechTeam's keys, comma lists and on-demand spellings", () => {
    expect(
      skillMetadata({ "techteam-type": "Practice", "techteam-load": "on-demand", "techteam-roles": "tester, reviewer, nobody", "techteam-requires": "tests.write tests.fly" })
    ).toEqual({ type: "practice", load: "on_demand", roles: ["tester", "reviewer"], requires: ["tests.write"] });
  });

  it("leaves absent or invalid values to the AI or the user", () => {
    expect(skillMetadata(undefined)).toEqual({ type: null, load: null, roles: null, requires: [] });
    expect(skillMetadata({ "techteam-type": "magic", "techteam-load": "sometimes" })).toMatchObject({ type: null, load: null, roles: null });
    expect(skillMetadata({ "techteam-roles": ["developer"] }).roles).toEqual(["developer"]);
  });
});

describe("default assignment", () => {
  it("enables a built-in only for the roles its source lists", () => {
    const mwg = sources.skills.find((s) => s.slug === "modern-web-guidance")!;
    expect(AGENT_KEYS.filter((key) => defaultAssignment(mwg.roles, key))).toEqual(["developer", "reviewer", "security"]);
    const ext = sources.skills.find((s) => s.slug === "chrome-extensions")!;
    expect(AGENT_KEYS.filter((key) => defaultAssignment(ext.roles, key))).toEqual([]);
  });

  it("sorts roles in team order", () => {
    expect(sortRoles(["tester", "analyst", "x"])).toEqual(["analyst", "tester"]);
  });

  it("has a catalog entry for every source", () => {
    expect(catalog.skills.map((s) => s.slug)).toEqual(sources.skills.map((s) => s.slug));
  });
});

describe("skillScanStatus", () => {
  it("blocks on critical, warns on anything else", () => {
    expect(skillScanStatus([])).toBe("passed");
    expect(skillScanStatus([{ severity: "low" }])).toBe("warned");
    expect(skillScanStatus([{ severity: "high" }, { severity: "critical" }])).toBe("blocked");
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2_033_189)).toBe("1.9 MB");
  });
});
