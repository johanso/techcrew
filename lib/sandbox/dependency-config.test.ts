import { describe, expect, it } from "vitest";

import {
  addDependencyCommand,
  declaredRange,
  dependencyChange,
  dependencyPlan,
  dependencyReadFiles,
  dependencyReport,
  isPackageName,
  isVersionSpec,
  parseDependencyArgs,
  resolvedVersion,
} from "@/lib/sandbox/dependency-config";

describe("isPackageName", () => {
  it("accepts npm names, scoped or not", () => {
    for (const name of ["zod", "@fontsource/inter", "@fontsource-variable/plus-jakarta-sans", "lodash.debounce", "a_b~c", "3d-force"]) {
      expect(isPackageName(name), name).toBe(true);
    }
  });

  it("refuses URLs, git, paths, flags, uppercase and shell characters", () => {
    for (const name of [
      "https://evil.example/x.tgz",
      "git+ssh://git@github.com/a/b.git",
      "github:a/b",
      "a/b",
      "file:../x",
      "./local",
      "../x",
      "-g",
      "--registry=x",
      "React",
      "a b",
      "a;rm -rf /",
      "a'b",
      "$(id)",
      "@scope",
      "@scope/",
      ".hidden",
      "_private",
      "x".repeat(215),
    ]) {
      expect(isPackageName(name), name).toBe(false);
    }
  });
});

describe("isVersionSpec", () => {
  it("accepts exact versions and one simple range", () => {
    for (const version of ["5.2.5", "1.0.0-beta.1", "1.0.0+build.7", "^5.2.0", "~5.2", "5.x", "5", "5.2.*", ">=5.0.0", "<2", "=1.2.3"]) {
      expect(isVersionSpec(version), version).toBe(true);
    }
  });

  it("refuses tags, URLs, protocols, aliases and compound ranges", () => {
    for (const version of ["next", "beta", "https://x.test/a.tgz", "file:../a", "link:../a", "npm:other@1", "git+https://x", "github:a/b", ">=1 <2", "1 || 2", "1.2.3 - 2", "^1.2.3'", "*", "01.2.3", "v1.2.3"]) {
      expect(isVersionSpec(version), version).toBe(false);
    }
  });
});

describe("parseDependencyArgs", () => {
  it("defaults to the latest release and dependencies", () => {
    expect(parseDependencyArgs({ name: " @fontsource/inter ", version: null, dev: false })).toEqual({ ok: true, value: { name: "@fontsource/inter", version: null, dev: false } });
    expect(parseDependencyArgs({ name: "zod", version: "latest" })).toEqual({ ok: true, value: { name: "zod", version: null, dev: false } });
    expect(parseDependencyArgs({ name: "vitest", version: "^3.2.0", dev: true })).toEqual({ ok: true, value: { name: "vitest", version: "^3.2.0", dev: true } });
  });

  it("explains what's wrong", () => {
    expect(parseDependencyArgs({})).toMatchObject({ ok: false, error: expect.stringContaining("name is required") });
    expect(parseDependencyArgs({ name: "@fontsource/inter@5.2.5" })).toMatchObject({ ok: false, error: expect.stringContaining("version in version") });
    expect(parseDependencyArgs({ name: "git+https://github.com/a/b" })).toMatchObject({ ok: false, error: expect.stringContaining("isn't an npm package name") });
    expect(parseDependencyArgs({ name: "zod", version: "next" })).toMatchObject({ ok: false, error: expect.stringContaining("exact version") });
    expect(parseDependencyArgs({ name: "zod", version: "file:../zod" })).toMatchObject({ ok: false });
    expect(parseDependencyArgs({ name: "zod", dev: "yes" })).toMatchObject({ ok: false, error: "dev must be true or false." });
  });
});

describe("addDependencyCommand", () => {
  it("resolves into the lockfile only, without scripts, and quotes the spec", () => {
    expect(addDependencyCommand({ name: "@fontsource/inter", version: null, dev: false })).toBe(
      "npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-prod '@fontsource/inter@latest'"
    );
    expect(addDependencyCommand({ name: "vitest", version: ">=3.0.0", dev: true })).toBe(
      "npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-dev 'vitest@>=3.0.0'"
    );
  });
});

describe("dependencyPlan", () => {
  it("commits the npm lockfile the repository has", () => {
    expect(dependencyPlan(["package.json", "package-lock.json", "README.md"])).toEqual({ ok: true, lockfile: "package-lock.json" });
    expect(dependencyPlan(["package.json", "npm-shrinkwrap.json", "package-lock.json"])).toEqual({ ok: true, lockfile: "npm-shrinkwrap.json" });
    expect(dependencyPlan(["package.json"])).toEqual({ ok: true, lockfile: null });
  });

  it("refuses repositories without package.json or on another package manager", () => {
    expect(dependencyPlan(["README.md"])).toMatchObject({ ok: false, error: expect.stringContaining("no package.json") });
    expect(dependencyPlan(["package.json", "pnpm-lock.yaml"])).toMatchObject({ ok: false, error: expect.stringContaining("uses pnpm (pnpm-lock.yaml)") });
    expect(dependencyPlan(["package.json", "package-lock.json", "yarn.lock"])).toMatchObject({ ok: false, error: expect.stringContaining("Yarn") });
    expect(dependencyPlan(["package.json", "bun.lockb"])).toMatchObject({ ok: false, error: expect.stringContaining("Bun") });
  });

  it("always reads a lockfile back, for the resolved version", () => {
    expect(dependencyReadFiles({ ok: true, lockfile: null })).toEqual(["package.json", "package-lock.json"]);
    expect(dependencyReadFiles({ ok: true, lockfile: "npm-shrinkwrap.json" })).toEqual(["package.json", "npm-shrinkwrap.json"]);
  });
});

const LOCK_V3 = JSON.stringify({
  lockfileVersion: 3,
  packages: { "": { dependencies: { "@fontsource/inter": "^5.3.0" } }, "node_modules/@fontsource/inter": { version: "5.3.0" } },
});
const LOCK_V1 = JSON.stringify({ lockfileVersion: 1, dependencies: { zod: { version: "3.25.1" } } });
const MANIFEST = JSON.stringify({ name: "demo", dependencies: { "@fontsource/inter": "^5.3.0" }, devDependencies: { vitest: "^3.2.0" } });

describe("resolvedVersion and declaredRange", () => {
  it("read the pinned version from v1, v2 and v3 lockfiles", () => {
    expect(resolvedVersion(LOCK_V3, "@fontsource/inter")).toBe("5.3.0");
    expect(resolvedVersion(LOCK_V1, "zod")).toBe("3.25.1");
    expect(resolvedVersion(LOCK_V3, "zod")).toBeNull();
    expect(resolvedVersion("not json", "zod")).toBeNull();
  });

  it("read the declared range from the right section", () => {
    expect(declaredRange(MANIFEST, "@fontsource/inter", false)).toBe("^5.3.0");
    expect(declaredRange(MANIFEST, "@fontsource/inter", true)).toBeNull();
    expect(declaredRange(MANIFEST, "vitest", true)).toBe("^3.2.0");
    expect(declaredRange("[]", "vitest", true)).toBeNull();
  });
});

describe("dependencyChange", () => {
  const inter = { name: "@fontsource/inter", version: null, dev: false };

  it("commits package.json and the lockfile", () => {
    expect(dependencyChange(inter, { ok: true, lockfile: "package-lock.json" }, { "package.json": MANIFEST, "package-lock.json": LOCK_V3 })).toEqual({
      ok: true,
      version: "5.3.0",
      range: "^5.3.0",
      files: [
        { path: "package.json", content: MANIFEST },
        { path: "package-lock.json", content: LOCK_V3 },
      ],
    });
  });

  it("commits only package.json in a repository without a lockfile", () => {
    const change = dependencyChange(inter, { ok: true, lockfile: null }, { "package.json": MANIFEST, "package-lock.json": LOCK_V3 });
    expect(change).toMatchObject({ ok: true, version: "5.3.0", files: [{ path: "package.json" }] });
  });

  it("refuses what npm didn't do", () => {
    const plan = { ok: true, lockfile: "package-lock.json" } as const;
    expect(dependencyChange(inter, plan, { "package.json": null, "package-lock.json": LOCK_V3 })).toMatchObject({ ok: false, error: expect.stringContaining("package.json couldn't be read") });
    expect(dependencyChange({ ...inter, dev: true }, plan, { "package.json": MANIFEST, "package-lock.json": LOCK_V3 })).toMatchObject({ ok: false, error: expect.stringContaining("devDependencies") });
    expect(dependencyChange(inter, plan, { "package.json": MANIFEST, "package-lock.json": null })).toMatchObject({ ok: false, error: expect.stringContaining("package-lock.json couldn't") });
    expect(dependencyChange(inter, plan, { "package.json": MANIFEST, "package-lock.json": LOCK_V1 })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't pin") });
  });
});

describe("dependencyReport", () => {
  const change = { ok: true as const, version: "5.3.0", range: "^5.3.0", files: [{ path: "package.json", content: "" }, { path: "package-lock.json", content: "" }] };

  it("confirms the package, the files and the commit on the first line", () => {
    const report = dependencyReport({ request: { name: "@fontsource/inter", version: null, dev: false }, change, branch: "agent/acm-1-font", commit: "abcdef1234567" });
    expect(report.split("\n")[0]).toBe('Added @fontsource/inter@5.3.0 to dependencies ("^5.3.0"): committed package.json and package-lock.json to agent/acm-1-font (abcdef1).');
  });

  it("says when nothing changed", () => {
    expect(dependencyReport({ request: { name: "@fontsource/inter", version: null, dev: false }, change, branch: "b", commit: null })).toBe(
      '@fontsource/inter@5.3.0 is already in dependencies ("^5.3.0"); nothing changed, so nothing was committed.'
    );
  });
});
