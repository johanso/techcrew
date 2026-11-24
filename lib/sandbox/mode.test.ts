import { describe, expect, it } from "vitest";

import {
  UNAVAILABLE_REASONS,
  parseDockerInfo,
  previewsReady,
  resolveSandboxStatus,
  sandboxSwitchedOff,
  unavailableMessage,
  unavailableSentence,
  type EngineProbe,
  type SandboxStatus,
} from "@/lib/sandbox/mode";

describe("parseDockerInfo", () => {
  it("reads a running Linux engine", () => {
    expect(parseDockerInfo({ code: 0, stdout: "linux|27.3.1\n" })).toEqual({ kind: "engine", osType: "linux", version: "27.3.1" });
  });

  it("reads a Windows-containers engine", () => {
    expect(parseDockerInfo({ code: 0, stdout: "windows|26.0.0\r\n" })).toEqual({ kind: "engine", osType: "windows", version: "26.0.0" });
  });

  it("calls a missing CLI missing", () => {
    expect(parseDockerInfo({ code: null, stdout: "", errorCode: "ENOENT" })).toEqual({ kind: "missing" });
  });

  it("calls a failing, timed out, empty or garbled answer stopped", () => {
    expect(parseDockerInfo({ code: 1, stdout: "" })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: 1, stdout: "linux|27" })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: null, stdout: "", timedOut: true })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: 0, stdout: "" })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: 0, stdout: "error during connect: open //./pipe/docker_engine" })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: 0, stdout: "|" })).toEqual({ kind: "stopped" });
    expect(parseDockerInfo({ code: null, stdout: "", errorCode: "EACCES" })).toEqual({ kind: "stopped" });
  });
});

describe("resolveSandboxStatus", () => {
  const engines: Record<string, EngineProbe> = {
    missing: { kind: "missing" },
    stopped: { kind: "stopped" },
    windows: { kind: "engine", osType: "windows", version: "26" },
    linux: { kind: "engine", osType: "linux", version: "27" },
  };
  const resolve = (host: string | null, engine: string, missingImages: string[] = [], disabled = false) =>
    resolveSandboxStatus({ host, disabled, engine: engines[engine]!, missingImages });

  it("uses the remote host whenever one is set, whatever this computer's Docker does", () => {
    for (const engine of Object.keys(engines)) {
      expect(resolve("ssh://u@h", engine, ["x"])).toEqual({ state: "ready", mode: "remote" });
    }
  });

  it("covers every local combination", () => {
    expect(resolve(null, "missing")).toEqual({ state: "unavailable", reason: "docker-missing", missing: [] });
    expect(resolve(null, "stopped")).toEqual({ state: "unavailable", reason: "docker-stopped", missing: [] });
    expect(resolve(null, "windows", ["node"])).toEqual({ state: "unavailable", reason: "windows-containers", missing: [] });
    expect(resolve(null, "linux", ["node:24", "techteam-browser:1"])).toEqual({
      state: "unavailable",
      reason: "images-missing",
      missing: ["node:24", "techteam-browser:1"],
    });
    expect(resolve(null, "linux")).toEqual({ state: "ready", mode: "local" });
  });

  it("is switched off by TECHTEAM_SANDBOX=off in both modes", () => {
    expect(resolve(null, "linux", [], true)).toEqual({ state: "unavailable", reason: "disabled", missing: [] });
    expect(resolve("ssh://u@h", "linux", [], true)).toEqual({ state: "unavailable", reason: "disabled", missing: [] });
  });
});

describe("sandboxSwitchedOff", () => {
  it("reads off, false, 0 and no, in any case", () => {
    for (const value of ["off", "OFF", " false ", "0", "no"]) expect(sandboxSwitchedOff(value)).toBe(true);
    for (const value of [undefined, "", "on", "1", "true"]) expect(sandboxSwitchedOff(value)).toBe(false);
  });
});

describe("previewsReady", () => {
  const local: SandboxStatus = { state: "ready", mode: "local" };
  const remote: SandboxStatus = { state: "ready", mode: "remote" };
  const off: SandboxStatus = { state: "unavailable", reason: "docker-stopped", missing: [] };

  it("needs a domain on a remote host only", () => {
    expect(previewsReady(local, null)).toBe(true);
    expect(previewsReady(remote, null)).toBe(false);
    expect(previewsReady(remote, "preview.example.com")).toBe(true);
    expect(previewsReady(off, "preview.example.com")).toBe(false);
  });
});

describe("unavailableMessage", () => {
  it("names the problem and the fix for every reason", () => {
    const texts = UNAVAILABLE_REASONS.map((reason) => unavailableMessage({ state: "unavailable", reason, missing: [] }));
    for (const { problem, fix } of texts) {
      expect(problem.length).toBeGreaterThan(10);
      expect(fix.length).toBeGreaterThan(10);
    }
    expect(new Set(texts.map((t) => t.problem)).size).toBe(UNAVAILABLE_REASONS.length);
  });

  it("says what the owner has to do", () => {
    const of = (reason: (typeof UNAVAILABLE_REASONS)[number]) => unavailableSentence({ state: "unavailable", reason, missing: [] });
    expect(of("docker-missing")).toMatch(/isn't installed.*docs\/setup\.md/);
    expect(of("docker-stopped")).toMatch(/not running.*Start it/);
    expect(of("windows-containers")).toMatch(/Windows-containers.*Linux containers/);
    expect(of("images-missing")).toMatch(/npm run sandbox:setup/);
    expect(of("disabled")).toMatch(/TECHTEAM_SANDBOX/);
  });
});
