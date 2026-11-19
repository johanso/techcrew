import { describe, expect, it } from "vitest";

import { detectCommands, isSandboxCommands, outputTail, parseSandboxCommand, sandboxReport, type SandboxRun } from "@/lib/sandbox/config";

describe("detectCommands", () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "x", scripts });

  it("installs with the lockfile's package manager and runs scripts through npm", () => {
    expect(detectCommands(pkg({ test: "vitest run", build: "vite build" }), ["package.json", "package-lock.json"])).toEqual({
      install: "npm ci",
      test: "npm test",
      build: "npm run build",
    });
    expect(detectCommands(pkg({}), ["pnpm-lock.yaml"]).install).toBe("npx --yes pnpm install --frozen-lockfile");
    expect(detectCommands(pkg({}), ["yarn.lock"]).install).toBe("npx --yes yarn install --frozen-lockfile");
    expect(detectCommands(pkg({}), ["package.json"]).install).toBe("npm install");
  });

  it("skips npm's placeholder test script and missing scripts", () => {
    expect(detectCommands(pkg({ test: 'echo "Error: no test specified" && exit 1' }), [])).toMatchObject({ test: null, build: null });
  });

  it("has nothing to run without a package.json, and survives a broken one", () => {
    expect(detectCommands(null, ["README.md"])).toEqual({ install: null, test: null, build: null });
    expect(detectCommands("{oops", ["package-lock.json"])).toEqual({ install: "npm ci", test: null, build: null });
  });
});

describe("parseSandboxCommand", () => {
  it("trims, treats empty as none and refuses multi-line or long commands", () => {
    expect(parseSandboxCommand("  npm test  ")).toEqual({ ok: true, command: "npm test" });
    expect(parseSandboxCommand("")).toEqual({ ok: true, command: null });
    expect(parseSandboxCommand(null)).toEqual({ ok: true, command: null });
    expect(parseSandboxCommand("npm ci\nnpm test").ok).toBe(false);
    expect(parseSandboxCommand("x".repeat(301)).ok).toBe(false);
  });
});

describe("isSandboxCommands", () => {
  it("accepts strings and nulls for every kind", () => {
    expect(isSandboxCommands({ install: "npm ci", test: null, build: "npm run build" })).toBe(true);
    expect(isSandboxCommands({ install: "npm ci", test: 1, build: null })).toBe(false);
    expect(isSandboxCommands(null)).toBe(false);
  });
});

describe("sandboxReport", () => {
  const run = (overrides: Partial<SandboxRun>): SandboxRun => ({
    command: "npm test",
    exitCode: 0,
    timedOut: false,
    failedStep: null,
    durationMs: 12_400,
    output: "4 passed",
    ...overrides,
  });

  it("starts with the outcome, then the end of the output", () => {
    expect(sandboxReport(run({}))).toBe("Passed: npm test (exit 0, 12.4 s)\n\nOutput (the end):\n4 passed");
    expect(sandboxReport(run({ failedStep: "command", exitCode: 1 })).split("\n")[0]).toBe("Failed: npm test (exit 1, 12.4 s)");
    expect(sandboxReport(run({ failedStep: "install", exitCode: 1, output: "" }))).toBe("Failed while installing dependencies: npm test (exit 1, 12.4 s)");
    expect(sandboxReport(run({ timedOut: true, failedStep: "command", exitCode: 137, durationMs: 300_000 })).split("\n")[0]).toBe(
      "Timed out after 5 min 0 s: npm test"
    );
  });
});

describe("outputTail", () => {
  it("drops color codes and keeps each progress line's last state", () => {
    expect(outputTail("\u001b[32m✓\u001b[39m ok\nloading 10%\rloading 100%\n")).toBe("✓ ok\nloading 100%");
  });

  it("keeps the end, cut at a line start", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const tail = outputTail(text, 40);
    expect(tail.startsWith("… [")).toBe(true);
    expect(tail.endsWith("line 99")).toBe(true);
    expect(tail.split("\n")[1]).toMatch(/^line \d+$/);
  });
});
