import { describe, expect, it } from "vitest";

import {
  PREVIEW_MAX_AGE_MS,
  detectCommands,
  isPreviewExpired,
  isSandboxCommands,
  outputTail,
  parseRunPreview,
  parseSandboxCommand,
  previewHost,
  previewLogSummary,
  previewTarget,
  previewUrl,
  sandboxCommandsOf,
  sandboxReport,
  type RunPreview,
  type SandboxRun,
} from "@/lib/sandbox/config";

describe("detectCommands", () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "x", scripts });

  it("installs with the lockfile's package manager and runs scripts through npm", () => {
    expect(detectCommands(pkg({ test: "vitest run", build: "vite build" }), ["package.json", "package-lock.json"])).toEqual({
      install: "npm ci",
      test: "npm test",
      build: "npm run build",
      preview: null,
    });
    expect(detectCommands(pkg({}), ["pnpm-lock.yaml"]).install).toBe("npx --yes pnpm install --frozen-lockfile");
    expect(detectCommands(pkg({}), ["yarn.lock"]).install).toBe("npx --yes yarn install --frozen-lockfile");
    expect(detectCommands(pkg({}), ["package.json"]).install).toBe("npm install");
  });

  it("skips npm's placeholder test script and missing scripts", () => {
    expect(detectCommands(pkg({ test: 'echo "Error: no test specified" && exit 1' }), [])).toMatchObject({ test: null, build: null });
  });

  it("has nothing to run without a package.json, and survives a broken one", () => {
    expect(detectCommands(null, ["README.md"])).toEqual({ install: null, test: null, build: null, preview: null });
    expect(detectCommands("{oops", ["package-lock.json"])).toEqual({ install: "npm ci", test: null, build: null, preview: null });
  });
});

describe("detectCommands: preview", () => {
  const pkg = (scripts: Record<string, string>, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}) =>
    JSON.stringify({ name: "x", scripts, dependencies: deps, devDependencies: devDeps });
  const preview = (json: string) => detectCommands(json, ["package-lock.json"]).preview;

  it("builds a Vite app, then serves it with vite preview on the preview port", () => {
    expect(preview(pkg({ build: "tsc && vite build" }, {}, { vite: "^8.0.0" }))).toBe(
      "npm run build && npx --no vite preview --host 0.0.0.0 --port 4173 --strictPort"
    );
    expect(preview(pkg({}, {}, { vite: "^8.0.0" }))).toBe("npx --no vite build && npx --no vite preview --host 0.0.0.0 --port 4173 --strictPort");
  });

  it("builds a Next.js app, then runs next start; Next wins over a Vite dev dependency", () => {
    expect(preview(pkg({ build: "next build", start: "next start" }, { next: "16.0.0" }, { vite: "^8.0.0" }))).toBe(
      "npm run build && npx --no next start -H 0.0.0.0 -p 4173"
    );
  });

  it("falls back to the start script (built first when there's a build), else nothing", () => {
    expect(preview(pkg({ start: "node server.js" }, { express: "^5.0.0" }))).toBe("npm start");
    expect(preview(pkg({ build: "tsc", start: "node dist/server.js" }))).toBe("npm run build && npm start");
    expect(preview(pkg({ test: "vitest run" }))).toBeNull();
  });
});

describe("sandboxCommandsOf", () => {
  it("reads rows saved before previews as preview: null", () => {
    expect(sandboxCommandsOf({ install: "npm ci", test: "npm test", build: null })).toEqual({
      install: "npm ci",
      test: "npm test",
      build: null,
      preview: null,
    });
    expect(sandboxCommandsOf({ install: null, test: null, build: null, preview: "npm start" })?.preview).toBe("npm start");
  });

  it("refuses anything that isn't commands", () => {
    expect(sandboxCommandsOf(null)).toBeNull();
    expect(sandboxCommandsOf({ install: 1 })).toBeNull();
  });
});

describe("previews", () => {
  const preview = (overrides: Partial<RunPreview> = {}): RunPreview => ({
    status: "running",
    host: "pr-12-k3x9ab.preview.example.com",
    prNumber: 12,
    round: 0,
    sha: "0123456789abcdef",
    startedAt: "2026-11-19T10:00:00.000Z",
    readyAt: "2026-11-19T10:00:42.000Z",
    endedAt: null,
    reason: null,
    ...overrides,
  });

  it("names the host after the pull request with a random slug, and checks its parts", () => {
    expect(previewHost(12, "k3x9ab", "preview.example.com")).toBe("pr-12-k3x9ab.preview.example.com");
    expect(() => previewHost(12, "K3X9AB", "preview.example.com")).toThrow();
    expect(() => previewHost(12, "abc", "preview.example.com")).toThrow();
    expect(() => previewHost(0, "k3x9ab", "preview.example.com")).toThrow();
    expect(() => previewHost(12, "k3x9ab", "not a domain")).toThrow();
    expect(previewUrl(preview())).toBe("https://pr-12-k3x9ab.preview.example.com");
  });

  it("keeps the contract's names: container and network share one name on port 4173", () => {
    expect(previewTarget(7)).toEqual({
      container: "techteam-preview-run-7",
      network: "techteam-preview-run-7",
      internalUrl: "http://techteam-preview-run-7:4173",
    });
  });

  it("expires live previews after two hours only", () => {
    const start = new Date("2026-11-19T10:00:00.000Z").getTime();
    expect(isPreviewExpired(preview(), start + PREVIEW_MAX_AGE_MS - 1)).toBe(false);
    expect(isPreviewExpired(preview(), start + PREVIEW_MAX_AGE_MS + 1)).toBe(true);
    expect(isPreviewExpired(preview({ status: "starting" }), start + PREVIEW_MAX_AGE_MS + 1)).toBe(true);
    expect(isPreviewExpired(preview({ status: "stopped" }), start + PREVIEW_MAX_AGE_MS + 1)).toBe(false);
  });

  it("parses stored previews and refuses malformed ones", () => {
    expect(parseRunPreview(preview())).toEqual(preview());
    expect(parseRunPreview({ ...preview(), status: "exploded" })).toBeNull();
    expect(parseRunPreview({ ...preview(), host: 1 })).toBeNull();
    expect(parseRunPreview(null)).toBeNull();
  });

  it("logs one line: where it runs and how long it took, or why it ended", () => {
    expect(previewLogSummary(preview())).toBe("Running at https://pr-12-k3x9ab.preview.example.com (ready in 42.0 s, commit 0123456)");
    expect(previewLogSummary(preview({ status: "failed", reason: "The preview command exited (code 1) before the app answered." }))).toBe(
      "Failed: The preview command exited (code 1) before the app answered."
    );
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
    expect(isSandboxCommands({ install: "npm ci", test: null, build: null, preview: "npm start" })).toBe(true);
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
