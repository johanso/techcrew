import { describe, expect, it } from "vitest";

import { cleanRepoPath, isLockfile, pathWriteRefusal } from "@/lib/repo-paths";

describe("pathWriteRefusal", () => {
  it("refuses protected paths for everyone", () => {
    for (const path of [".github/workflows/ci.yml", ".env", "app/.env.local", ".git/config", ".techteam/memory/conventions.md", ".techteam/memory/notes/a.md"]) {
      expect(pathWriteRefusal(path, ["code.write", "deps.manage"]), path).toMatch(/^Refused: .* is protected/);
    }
    expect(pathWriteRefusal(".env.example", [])).toBeNull();
    expect(pathWriteRefusal(".github/dependabot.yml", [])).toBeNull();
  });

  it("needs Manage dependencies for manifests and lockfiles", () => {
    expect(pathWriteRefusal("package.json", ["code.write"])).toMatch(/Manage dependencies/);
    expect(pathWriteRefusal("web/package-lock.json", ["code.write"])).toMatch(/Manage dependencies/);
    expect(pathWriteRefusal("package.json", ["code.write", "deps.manage"])).toBeNull();
    expect(pathWriteRefusal("src/package.ts", ["code.write"])).toBeNull();
  });
});

describe("isLockfile", () => {
  it("knows lockfiles, not manifests", () => {
    expect(isLockfile("package-lock.json")).toBe(true);
    expect(isLockfile("apps/web/yarn.lock")).toBe(true);
    expect(isLockfile("package.json")).toBe(false);
    expect(isLockfile("go.mod")).toBe(false);
  });
});

describe("cleanRepoPath", () => {
  it("accepts relative paths only", () => {
    expect(cleanRepoPath("./src/a.ts")).toBe("src/a.ts");
    expect(cleanRepoPath(" src/a.ts ")).toBe("src/a.ts");
    for (const bad of ["/etc/passwd", "../x", "a//b", "a/../b", "", 3]) expect(cleanRepoPath(bad), String(bad)).toBeNull();
  });
});
