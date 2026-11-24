import { describe, expect, it } from "vitest";

import { FORMAT_VERSION, buildManifest, checkMigrationsApplied, compareSchemaVersions, latestSchemaVersion, parseManifest } from "./manifest.mjs";

const manifest = () =>
  buildManifest({
    appVersion: "0.7.0",
    schemaVersion: 18,
    schemaTag: "0018_premium_freak",
    tables: { users: { rows: 1, columns: ["id", "email"] } },
    fileCount: 2,
    now: new Date("2026-11-24T10:00:00Z"),
  });

describe("manifest", () => {
  it("round-trips through its text", () => {
    expect(parseManifest(JSON.stringify(manifest()))).toEqual(manifest());
    expect(manifest().createdAt).toBe("2026-11-24T10:00:00.000Z");
  });

  it("refuses what is not ours or not valid", () => {
    expect(() => parseManifest("nope")).toThrow(/not valid JSON/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), tool: "other" }))).toThrow(/not made by/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), formatVersion: FORMAT_VERSION + 1 }))).toThrow(/not supported/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), schemaVersion: "18" }))).toThrow(/schemaVersion/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), tables: { "Users; DROP": { rows: 1, columns: [] } } }))).toThrow(/table name/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), tables: { users: { rows: -1, columns: [] } } }))).toThrow(/row count/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), tables: { users: { rows: 1, columns: ["a b"] } } }))).toThrow(/columns/);
    expect(() => parseManifest("x".repeat(2 * 1024 * 1024))).toThrow(/too large/);
  });
});

describe("versions", () => {
  it("reads the newest migration of a journal", () => {
    const journal = JSON.stringify({
      entries: [
        { idx: 0, tag: "0000_a" },
        { idx: 1, tag: "0001_b" },
      ],
    });
    expect(latestSchemaVersion(journal)).toEqual({ version: 1, tag: "0001_b", count: 2 });
    expect(() => latestSchemaVersion(JSON.stringify({ entries: [] }))).toThrow();
  });

  it("accepts the same or an older archive and refuses a newer one", () => {
    expect(compareSchemaVersions(18, 18)).toEqual({ ok: true, older: false });
    expect(compareSchemaVersions(10, 18)).toEqual({ ok: true, older: true });
    const newer = compareSchemaVersions(19, 18);
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.message).toMatch(/Update TechTeam/);
  });

  it("checks the target's applied migrations", () => {
    expect(checkMigrationsApplied(19, 19)).toEqual({ ok: true });
    expect(checkMigrationsApplied(25, 19)).toEqual({ ok: true });
    const behind = checkMigrationsApplied(10, 19);
    expect(!behind.ok && behind.message).toMatch(/db:migrate/);
    expect(checkMigrationsApplied(null, 19).ok).toBe(false);
  });
});
