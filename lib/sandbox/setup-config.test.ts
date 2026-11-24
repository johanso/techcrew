import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BROWSER_IMAGE_TAG, SANDBOX_IMAGE_DEFAULT, browserImageName, sandboxImageName } from "./engine.mjs";
import { describeStep, formatImageSize, parseSetupArgs, setupPlan } from "./setup-config.mjs";

const images = { sandbox: "node:24-bookworm", browser: "techteam-browser:1.64.1-4" };
const linux = { kind: "engine" as const, osType: "linux", version: "27" };
const plan = (overrides: Partial<Parameters<typeof setupPlan>[0]> = {}) =>
  setupPlan({ remoteHost: null, remoteFlag: false, engine: linux, present: { sandbox: false, browser: false }, images, ...overrides });

describe("parseSetupArgs", () => {
  it("reads the flags and reports unknown ones", () => {
    expect(parseSetupArgs([])).toEqual({ check: false, remote: false, help: false, unknown: [] });
    expect(parseSetupArgs(["--check", "--remote"])).toMatchObject({ check: true, remote: true });
    expect(parseSetupArgs(["-h"]).help).toBe(true);
    expect(parseSetupArgs(["--prune"]).unknown).toEqual(["--prune"]);
  });
});

describe("setupPlan", () => {
  it("downloads the sandbox image and builds the browser image when both are missing", () => {
    expect(plan()).toEqual({
      refusal: null,
      steps: [
        { id: "sandbox-image", image: images.sandbox, action: "pull" },
        { id: "browser-image", image: images.browser, action: "build" },
      ],
    });
  });

  it("does nothing for images that are already there, so a second run is a no-op", () => {
    expect(plan({ present: { sandbox: true, browser: true } }).steps.map((step) => step.action)).toEqual(["have", "have"]);
    expect(plan({ present: { sandbox: true, browser: false } }).steps.map((step) => step.action)).toEqual(["have", "build"]);
  });

  it("refuses a remote host unless asked, because deploy/setup.sh prepares those", () => {
    expect(plan({ remoteHost: "ssh://u@h" }).refusal).toMatch(/deploy\/setup\.sh/);
    expect(plan({ remoteHost: "ssh://u@h", remoteFlag: true }).refusal).toBeNull();
  });

  it("refuses when Docker is missing, stopped or in Windows-containers mode, saying what to do", () => {
    expect(plan({ engine: { kind: "missing" } }).refusal).toMatch(/isn't installed/);
    expect(plan({ engine: { kind: "stopped" } }).refusal).toMatch(/Start Docker/);
    expect(plan({ engine: { kind: "engine", osType: "windows", version: "26" } }).refusal).toMatch(/Linux containers/);
    expect(plan({ engine: { kind: "missing" } }).steps).toEqual([]);
  });

  it("describes each step", () => {
    expect(describeStep({ id: "sandbox-image", image: "node:24-bookworm", action: "pull" })).toBe("Sandbox image node:24-bookworm: will be downloaded");
    expect(describeStep({ id: "browser-image", image: "b:1", action: "build" })).toContain("built from deploy/browser");
    expect(describeStep({ id: "browser-image", image: "b:1", action: "have" })).toContain("already there");
  });
});

describe("formatImageSize", () => {
  it("prints MB below a gigabyte and GB above", () => {
    expect(formatImageSize(150 * 1024 ** 2)).toBe("150 MB");
    expect(formatImageSize(1.5 * 1024 ** 3)).toBe("1.50 GB");
    expect(formatImageSize(Number.NaN)).toBe("unknown size");
  });
});

describe("image names", () => {
  it("default to the pinned ones and honor the overrides", () => {
    expect(sandboxImageName({})).toBe(SANDBOX_IMAGE_DEFAULT);
    expect(sandboxImageName({ SANDBOX_IMAGE: " node:22 " })).toBe("node:22");
    expect(browserImageName({})).toBe(BROWSER_IMAGE_TAG);
    expect(browserImageName({ SANDBOX_BROWSER_IMAGE: "mine:1" })).toBe("mine:1");
  });

  it("keep the browser tag the Dockerfile builds", () => {
    const dockerfile = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "deploy", "browser", "Dockerfile"), "utf8");
    expect(dockerfile).toContain(`docker build --pull -t ${BROWSER_IMAGE_TAG} deploy/browser`);
  });
});
