// What a backup contains: the Drizzle schema, minus everything secret. Pure (it only reads the schema's metadata), and a
// plain .mjs so `node` runs it for the scripts and Vitest imports it for the tests, like lib/local-db-config.mjs.
// The schema file is TypeScript; Node 22.18+ strips its types when it is imported.
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../../db/schema.ts";

/**
 * Tables that never go in an archive, with the reason. A new table that holds a key, a token or machine-specific
 * state must be listed here (registry.test.ts walks the whole schema and fails otherwise).
 * @type {Record<string, string>}
 */
export const EXCLUDED_TABLES = {
  github_connections: "GitHub token (the next sign-in creates it again)",
  user_ai_keys: "AI provider keys",
  cli_settings: "settings of one computer's CLI (machine id, confirmed plan account)",
  model_catalog: "a cache the app refetches from OpenRouter",
};

/**
 * Columns left out of an otherwise exported table, with the reason. They are nullable or have a default, so a restore
 * leaves them empty.
 * @type {Record<string, Record<string, string>>}
 */
export const SECRET_COLUMNS = {};

/**
 * Tables of earlier versions that the schema no longer has (migration 0020). An archive made by v0.9.0 or before may
 * list them: a restore skips their rows with a warning instead of refusing the archive. A table that is neither in the
 * schema nor listed here is still a hard error. Never reuse a retired name for a new table.
 * @type {Record<string, string>}
 */
export const RETIRED_TABLES = {
  ai_provider_keys: "workspace-level AI keys (keys live on the account now)",
  switch_connections: "Switch Trust connections (Switch Trust was removed)",
  trust_scans: "SwitchAgent scans (Switch Trust was removed)",
};

/** Column names that look like they hold a secret. Every match must be classified (excluded, dropped or reviewed). */
export const SECRET_PATTERN = /token|secret|password|api_?key|ciphertext|cookie/i;

/**
 * Columns whose name matches SECRET_PATTERN, were reviewed, and are safe to export.
 * @type {Record<string, Record<string, string>>}
 */
export const REVIEWED_SAFE_COLUMNS = {
  agent_activity: { tokens: "a count of model tokens, not a credential" },
};

/** The notice printed after an export. */
export const AFTER_RESTORE_NOTE = "After restoring, sign in with GitHub and enter your AI keys again.";

const SIMPLE_KINDS = {
  PgSerial: "serial",
  PgInteger: "integer",
  PgBigInt53: "bigint",
  PgBigInt64: "bigint",
  PgText: "text",
  PgBoolean: "boolean",
  PgTimestamp: "timestamp",
  PgDate: "date",
  PgDateString: "date",
  PgJsonb: "jsonb",
};

/**
 * How a column is serialized: one of serial, integer, bigint, text, boolean, timestamp, date, jsonb, array.
 * Throws for a column type nobody has taught the backup, so a new type can't be exported wrongly.
 * @param {{ columnType: string; name: string }} column
 * @returns {"serial" | "integer" | "bigint" | "text" | "boolean" | "timestamp" | "date" | "jsonb" | "array"}
 */
export function columnKind(column) {
  if (column.columnType === "PgArray") return "array";
  const kind = SIMPLE_KINDS[/** @type {keyof typeof SIMPLE_KINDS} */ (column.columnType)];
  if (!kind) throw new Error(`The backup does not know the column type ${column.columnType} (column ${column.name}).`);
  return kind;
}

/**
 * @typedef {{ name: string; kind: ReturnType<typeof columnKind>; notNull: boolean; hasDefault: boolean; primary: boolean }} ColumnInfo
 * @typedef {{ column: string; references: string; nullable: boolean }} ForeignKeyInfo
 * @typedef {{ name: string; columns: ColumnInfo[]; foreignKeys: ForeignKeyInfo[]; primaryKey: string | null; serialColumns: string[] }} TableInfo
 */

/**
 * Every table of the schema with its exportable columns (secret ones removed) and foreign keys, sorted by name. Tables of
 * EXCLUDED_TABLES are not in it.
 * @returns {TableInfo[]}
 */
export function exportTables() {
  return allTables()
    .filter((table) => !(table.name in EXCLUDED_TABLES))
    .map((table) => {
      const dropped = SECRET_COLUMNS[table.name] ?? {};
      const columns = table.columns.filter((column) => !(column.name in dropped));
      const kept = new Set(columns.map((column) => column.name));
      return {
        ...table,
        columns,
        // A foreign key on a dropped column can't be restored from the archive.
        foreignKeys: table.foreignKeys.filter((fk) => kept.has(fk.column)),
        serialColumns: columns.filter((column) => column.kind === "serial").map((column) => column.name),
      };
    });
}

/**
 * Every table of the schema, secret columns included (what the guard test walks).
 * @returns {TableInfo[]}
 */
export function allTables() {
  /** @type {TableInfo[]} */
  const tables = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.schema && config.schema !== "public") continue;
    const columns = config.columns.map((column) => ({
      name: column.name,
      kind: columnKind(column),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
      primary: column.primary,
    }));
    const foreignKeys = config.foreignKeys.flatMap((fk) => {
      const reference = fk.reference();
      return reference.columns.map((column) => ({
        column: column.name,
        references: getTableConfig(reference.foreignTable).name,
        nullable: !column.notNull,
      }));
    });
    const primary = columns.filter((column) => column.primary);
    tables.push({
      name: config.name,
      columns,
      foreignKeys,
      primaryKey: primary.length === 1 ? primary[0].name : null,
      serialColumns: columns.filter((column) => column.kind === "serial").map((column) => column.name),
    });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a finished export lists as left out. @returns {string[]} */
export function excludedSummary() {
  return [
    ...Object.entries(EXCLUDED_TABLES).map(([table, why]) => `table ${table}: ${why}`),
    ...Object.entries(SECRET_COLUMNS).flatMap(([table, columns]) =>
      Object.entries(columns).map(([column, why]) => `column ${table}.${column}: ${why}`),
    ),
  ];
}
