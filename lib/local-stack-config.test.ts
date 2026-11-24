import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INNGEST_CLI_VERSION, buildDecision, inngestPortFlags, parsePortSetting, resolveAppPort, resolveInngestPort } from "./local-stack-config.mjs";

describe("ports", () => {
  it("defaults to 3000 and 8288", () => {
    expect(resolveAppPort({})).toBe(3000);
    expect(resolveInngestPort({})).toBe(8288);
  });
  it("takes valid overrides only", () => {
    expect(resolveAppPort({ TECHTEAM_PORT: " 3995 " })).toBe(3995);
    expect(resolveInngestPort({ TECHTEAM_INNGEST_PORT: "8299" })).toBe(8299);
    for (const bad of ["0", "70000", "abc", "", "30.5"]) expect(parsePortSetting(bad, 3000)).toBe(3000);
  });
  it("moves the Dev Server's connect ports with a non-default port", () => {
    expect(inngestPortFlags(8288)).toEqual([]);
    expect(inngestPortFlags(8299)).toEqual(["--connect-gateway-port", "8300", "--connect-gateway-grpc-port", "50063", "--connect-executor-grpc-port", "50064"]);
  });
});

describe("buildDecision", () => {
  const base = { hasBuildId: true, storedRev: "abc", headRev: "abc", rebuild: false };
  it("skips the build when it is current", () => {
    expect(buildDecision(base).build).toBe(false);
  });
  it("builds when there is no build", () => {
    expect(buildDecision({ ...base, hasBuildId: false })).toMatchObject({ build: true, reason: "there is no build yet" });
  });
  it("builds when the revision changed or was never recorded", () => {
    expect(buildDecision({ ...base, headRev: "def" }).build).toBe(true);
    expect(buildDecision({ ...base, storedRev: null }).build).toBe(true);
  });
  it("builds on --rebuild", () => {
    expect(buildDecision({ ...base, rebuild: true }).build).toBe(true);
  });
  it("without git, builds only when no build exists", () => {
    expect(buildDecision({ hasBuildId: true, storedRev: "abc", headRev: null, rebuild: false }).build).toBe(false);
    expect(buildDecision({ hasBuildId: false, storedRev: null, headRev: null, rebuild: false }).build).toBe(true);
  });
});

describe("the pinned Inngest Dev Server", () => {
  it("is an exact version, the same in package.json", () => {
    expect(INNGEST_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["inngest:dev"]).toContain(`inngest-cli@${INNGEST_CLI_VERSION} `);
    expect(pkg.engines.node).toBe(">=22.18");
  });
});
