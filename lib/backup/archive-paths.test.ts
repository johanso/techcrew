import { describe, expect, it } from "vitest";

import { checkListing, classifyEntry, pairTypes } from "./archive-paths.mjs";

const tables = new Set(["users", "tasks"]);
const entry = (name: string, type = "-") => ({ name, type });

describe("classifyEntry", () => {
  it("accepts the manifest, table files, stored files and their folders", () => {
    expect(classifyEntry("manifest.json")).toEqual({ kind: "manifest" });
    expect(classifyEntry("tables/users.jsonl")).toEqual({ kind: "table", table: "users" });
    expect(classifyEntry("files/workspace-logos/1/a.png")).toEqual({ kind: "file", key: "workspace-logos/1/a.png" });
    expect(classifyEntry("tables/")).toEqual({ kind: "directory" });
    expect(classifyEntry("files/card-references/")).toEqual({ kind: "directory" });
  });

  it.each([
    "../evil",
    "files/../../evil",
    "/etc/passwd",
    "C:/Windows/x",
    "c:\\x",
    "files\\a.png",
    "files/a/../b.png",
    "files//a.png",
    "files/./a.png",
    "files/.hidden",
    "files/a%2e.png",
    "files/a:b",
    "tables/users.csv",
    "tables/Users.jsonl",
    "tables/a/b.jsonl",
    "other.txt",
    "./manifest.json",
    "._manifest.json",
    "files/a\nb",
    "files/a\0b",
    "",
    "files",
    "x/",
  ])("refuses %j", (name) => {
    expect(classifyEntry(name).kind).toBe("refused");
  });
});

describe("checkListing", () => {
  const good = [entry("manifest.json"), entry("tables/", "d"), entry("tables/users.jsonl"), entry("files/", "d"), entry("files/a/b.png")];

  it("passes a well-formed archive", () => {
    expect(checkListing(good, tables)).toEqual({ problems: [], tables: ["users"], files: ["a/b.png"] });
  });

  it("reports links, unknown tables, doubles and a missing manifest", () => {
    expect(checkListing([...good, entry("files/link", "l")], tables).problems[0]).toMatch(/link or special/);
    expect(checkListing([...good, entry("files/hard", "h")], tables).problems).toHaveLength(1);
    expect(checkListing([...good, entry("tables/secrets.jsonl")], tables).problems[0]).toMatch(/not a table/);
    expect(checkListing([...good, entry("files/a/b.png")], tables).problems[0]).toMatch(/twice/);
    expect(checkListing(good.slice(1), tables).problems).toContain("the archive needs exactly one manifest.json");
    expect(checkListing([...good, entry("files/x/", "-")], tables).problems[0]).toMatch(/type does not match/);
  });
});

describe("pairTypes", () => {
  it("takes the type letter of each verbose line", () => {
    expect(pairTypes("-rw-r--r-- 0 a b 1 Nov 24 10:00 x\ndrwxr-xr-x 0 a b 0 Nov 24 10:00 y/\n", ["x", "y/"])).toEqual([entry("x"), entry("y/", "d")]);
    expect(() => pairTypes("-rw x\n", ["a", "b"])).toThrow(/inconsistent/);
  });
});
