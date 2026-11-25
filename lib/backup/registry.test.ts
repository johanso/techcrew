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

  it("includes what the librarian proposed and decided, so a restore doesn't propose it again", () => {
    expect(exportTables().map((table) => table.name)).toContain("memory_proposals");
    expect(excludedSummary().join("\n")).not.toContain("memory_");
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

  it("exports the Brain's notes whole: no secret column, no exclusion, its foreign keys and the workspace columns", () => {
    expect(EXCLUDED_TABLES).not.toHaveProperty("memory_notes");
    expect(SECRET_COLUMNS).not.toHaveProperty("memory_notes");
    const tables = new Map(exportTables().map((table) => [table.name, table]));
    const notes = tables.get("memory_notes");
    expect(notes?.columns.map((column) => column.name)).toEqual([
      "id", "user_id", "workspace_id", "scope", "type", "title", "body", "load", "status", "paths", "source", "origin", "content_hash", "created_at", "updated_at",
    ]);
    expect(notes?.columns.find((column) => column.name === "paths")?.kind).toBe("array");
    expect(notes?.columns.find((column) => column.name === "source")?.kind).toBe("jsonb");
    expect(notes?.foreignKeys).toEqual([
      { column: "user_id", references: "users", nullable: false },
      { column: "workspace_id", references: "workspaces", nullable: true },
    ]);
    const workspace = tables.get("workspaces")?.columns;
    expect(workspace?.find((column) => column.name === "memory_mode")).toMatchObject({ kind: "text", notNull: true, hasDefault: true });
    expect(workspace?.find((column) => column.name === "memory_bootstrapped_at")).toMatchObject({ kind: "timestamp", notNull: false });
  });

  it("exports the Brain's signals whole: no secret column, its foreign keys and the pull request's question", () => {
    expect(EXCLUDED_TABLES).not.toHaveProperty("memory_signals");
    expect(SECRET_COLUMNS).not.toHaveProperty("memory_signals");
    const tables = new Map(exportTables().map((table) => [table.name, table]));
    const signals = tables.get("memory_signals");
    expect(signals?.columns.map((column) => column.name)).toEqual([
      "id", "workspace_id", "kind", "source_key", "run_id", "pr_number", "task_id", "payload", "trusted", "created_at", "consumed_at",
    ]);
    expect(signals?.columns.find((column) => column.name === "payload")?.kind).toBe("jsonb");
    expect(signals?.foreignKeys).toEqual([
      { column: "workspace_id", references: "workspaces", nullable: false },
      { column: "run_id", references: "agent_runs", nullable: true },
      { column: "task_id", references: "tasks", nullable: true },
    ]);
    expect(tables.get("pull_requests")?.columns.find((column) => column.name === "rejection_prompt")).toMatchObject({ kind: "text", notNull: false });
  });

  it("has `id` as the primary key of every table with a serial column", () => {
    for (const table of exportTables()) {
      if (table.serialColumns.length > 0) expect(table.primaryKey, table.name).toBe("id");
    }
  });
});
