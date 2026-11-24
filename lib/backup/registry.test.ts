import { describe, expect, it } from "vitest";

import {
  EXCLUDED_TABLES,
  RETIRED_TABLES,
  REVIEWED_SAFE_COLUMNS,
  SECRET_COLUMNS,
  SECRET_PATTERN,
  allTables,
  columnKind,
  excludedSummary,
  exportTables,
} from "./registry.mjs";

describe("secret guard", () => {
  it("classifies every column whose name looks like a secret", () => {
    const unclassified: string[] = [];
    for (const table of allTables()) {
      if (table.name in EXCLUDED_TABLES) continue;
      for (const column of table.columns) {
        if (!SECRET_PATTERN.test(column.name)) continue;
        const dropped = column.name in (SECRET_COLUMNS[table.name] ?? {});
        const reviewed = column.name in (REVIEWED_SAFE_COLUMNS[table.name] ?? {});
        if (!dropped && !reviewed) unclassified.push(`${table.name}.${column.name}`);
      }
    }
    // A new column that looks like a secret must be dropped (SECRET_COLUMNS), reviewed safe, or its table excluded.
    expect(unclassified).toEqual([]);
  });

  it("only names tables and columns that exist", () => {
    const tables = new Map(allTables().map((table) => [table.name, new Set(table.columns.map((column) => column.name))]));
    for (const name of Object.keys(EXCLUDED_TABLES)) expect(tables.has(name), name).toBe(true);
    // A retired table is gone from the schema for good: a new table must not reuse its name.
    for (const name of Object.keys(RETIRED_TABLES)) expect(tables.has(name), name).toBe(false);
    for (const registry of [SECRET_COLUMNS, REVIEWED_SAFE_COLUMNS]) {
      for (const [table, columns] of Object.entries(registry)) {
        for (const column of Object.keys(columns)) expect(tables.get(table)?.has(column), `${table}.${column}`).toBe(true);
      }
    }
  });

  it("excludes the tables that hold keys, tokens or machine state", () => {
    const names = exportTables().map((table) => table.name);
    for (const secret of ["github_connections", "user_ai_keys", "cli_settings"]) {
      expect(names).not.toContain(secret);
    }
  });

  it("drops secret columns only where a restore can leave them empty", () => {
    for (const [table, columns] of Object.entries(SECRET_COLUMNS)) {
      const info = allTables().find((candidate) => candidate.name === table);
      for (const column of Object.keys(columns)) {
        const found = info?.columns.find((candidate) => candidate.name === column);
        expect(found?.notNull && !found.hasDefault, `${table}.${column}`).toBe(false);
      }
    }
  });

  it("never exports a retired table, so a backup of an old database leaves its leftovers behind", () => {
    const names = exportTables().map((table) => table.name);
    for (const name of Object.keys(RETIRED_TABLES)) expect(names).not.toContain(name);
  });

  it("lists what was left out", () => {
    const summary = excludedSummary().join("\n");
    expect(summary).toContain("github_connections");
    expect(summary).toContain("cli_settings");
  });
});

describe("schema coverage", () => {
  it("knows how to serialize every column type of the schema", () => {
    const kinds = new Set(allTables().flatMap((table) => table.columns.map((column) => column.kind)));
    expect([...kinds].sort()).toEqual(["array", "bigint", "boolean", "date", "integer", "jsonb", "serial", "text", "timestamp"]);
  });

  it("refuses a column type nobody has taught it", () => {
    expect(() => columnKind({ columnType: "PgNumeric", name: "price" })).toThrow(/PgNumeric/);
  });

  it("never exports the auth schema or drizzle's table", () => {
    const names = exportTables().map((table) => table.name);
    expect(names.some((name) => name.includes("migrations") || name.includes("session"))).toBe(false);
    expect(names).toContain("agent_run_messages");
  });

  it("has `id` as the primary key of every table with a serial column", () => {
    for (const table of exportTables()) {
      if (table.serialColumns.length > 0) expect(table.primaryKey, table.name).toBe("id");
    }
  });
});
