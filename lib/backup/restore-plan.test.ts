import { describe, expect, it } from "vitest";

import { checkListing } from "./archive-paths.mjs";
import { planRestore } from "./import.mjs";
import { RETIRED_TABLES, exportTables } from "./registry.mjs";

const entry = (name: string, type = "-") => ({ name, type });

const manifestOf = (tables: Record<string, { rows: number; columns: string[] }>) => ({
  tool: "techteam-backup",
  formatVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  appVersion: "0.9.0",
  schemaVersion: 19,
  schemaTag: "0019_curly_screwball",
  fileCount: 0,
  tables,
});

describe("archives made before migration 0020", () => {
  it("accepts a rows file of a retired table in the listing, and still refuses an unknown one", () => {
    const known = new Set([...exportTables().map((table) => table.name), ...Object.keys(RETIRED_TABLES)]);
    const listing = [entry("manifest.json"), entry("tables/", "d"), entry("tables/users.jsonl"), entry("tables/trust_scans.jsonl")];
    expect(checkListing(listing, known).problems).toEqual([]);
    expect(checkListing([...listing, entry("tables/secrets.jsonl")], known).problems[0]).toMatch(/not a table/);
  });

  it("skips a retired table with one warning and ignores a retired column", () => {
    const warnings: string[] = [];
    const users = exportTables().find((table) => table.name === "users");
    const columns = [...(users?.columns.map((column) => column.name) ?? []), "auth_user_id"];
    const plan = planRestore(manifestOf({ users: { rows: 1, columns }, trust_scans: { rows: 3, columns: ["id"] } }), (message) => warnings.push(message));
    expect(plan.tables.map((table) => table.table.name)).toEqual(["users"]);
    expect(warnings.filter((message) => message.includes("trust_scans"))).toHaveLength(1);
    expect(warnings.some((message) => message.includes("users.auth_user_id"))).toBe(true);
  });

  it("still refuses a table nobody knows", () => {
    expect(() => planRestore(manifestOf({ mystery: { rows: 1, columns: ["id"] } }), () => undefined)).toThrow(/does not know: mystery/);
  });
});
