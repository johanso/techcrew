// `npm run restore`: an archive into an empty database. Never destructive: it refuses a database that already holds a
// user or a workspace. The archive is untrusted input: it is checked entry by entry, extracted into a fresh folder of
// the data dir (never straight into place), and everything inserted is checked against the schema first. All rows go
// in ONE transaction: any failure, or a row count that differs from the manifest, rolls everything back.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDataDir } from "../local-db-config.mjs";
import { keyPath } from "../storage-key.mjs";
import { checkListing } from "./archive-paths.mjs";
import { connect, resolveDatabase } from "./connection.mjs";
import { MANIFEST_MAX_BYTES, checkMigrationsApplied, compareSchemaVersions, latestSchemaVersion, parseManifest } from "./manifest.mjs";
import { restoreOrder } from "./order.mjs";
import { AFTER_RESTORE_NOTE, exportTables } from "./registry.mjs";
import { deferredUpdateSql, insertSql, parseLine, quote } from "./rows.mjs";
import { extractArchive, inspectExtracted, listArchive } from "./tar.mjs";
import { readLines } from "./lines.mjs";
import { formatBytes } from "./format.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BATCH_ROWS = 500;
const BATCH_BYTES = 8 * 1024 * 1024;

/** @param {string} file */
async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/**
 * The tables to restore and how: the archive's columns the schema knows, the circular foreign keys to set afterwards.
 * Throws when a required column is missing from the archive.
 * @param {import("./manifest.mjs").Manifest} manifest
 * @param {(message: string) => void} warn
 */
export function planRestore(manifest, warn) {
  const registry = exportTables();
  const known = new Map(registry.map((table) => [table.name, table]));
  for (const name of Object.keys(manifest.tables)) {
    if (!known.has(name)) throw new Error(`The archive has a table this TechTeam does not know: ${name}.`);
  }
  const wanted = registry.filter((table) => table.name in manifest.tables);
  const { order, deferred } = restoreOrder(wanted);
  const deferredWithKinds = deferred.map(({ table: name, column }) => {
    const table = /** @type {NonNullable<ReturnType<typeof known.get>>} */ (known.get(name));
    const primary = table.columns.find((candidate) => candidate.name === table.primaryKey);
    if (!primary) throw new Error(`${name} has no single primary key to set ${column} afterwards.`);
    const kind = table.columns.find((candidate) => candidate.name === column)?.kind;
    return { table: name, column, primaryKey: primary.name, primaryKind: primary.kind, valueKind: kind === "bigint" ? "bigint" : "integer" };
  });
  return {
    deferred: deferredWithKinds,
    tables: order.map((name) => {
      const table = /** @type {NonNullable<ReturnType<typeof known.get>>} */ (known.get(name));
      const inArchive = new Set(manifest.tables[name].columns);
      const columns = table.columns.filter((column) => inArchive.has(column.name));
      for (const extra of inArchive) {
        if (!table.columns.some((column) => column.name === extra)) warn(`${name}.${extra} is in the archive but not in this version's schema: ignored.`);
      }
      for (const column of table.columns) {
        if (!inArchive.has(column.name) && column.notNull && !column.hasDefault) {
          throw new Error(`The archive lacks ${name}.${column.name}, which this version requires and has no default for.`);
        }
      }
      return { table, columns, nulled: deferred.filter((d) => d.table === name).map((d) => d.column) };
    }),
  };
}

/**
 * @param {{
 *   env: Record<string, string | undefined>; archive: string;
 *   log: (message: string) => void; warn: (message: string) => void;
 * }} options
 */
export async function runRestore({ env, archive, log, warn }) {
  const archivePath = path.resolve(archive);
  if (!existsSync(archivePath)) throw new Error(`${archivePath} does not exist.`);
  const { url, label } = resolveDatabase(env);
  const dataDir = resolveDataDir(env);
  const temp = path.join(dataDir, "tmp", `restore-${randomBytes(6).toString("hex")}`);
  const sql = connect(url);
  const started = Date.now();
  try {
    log(`1/6 Checking ${label}.`);
    const journal = latestSchemaVersion(readFileSync(path.join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
    const [{ applied }] = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS applied`;
    let migrations = null;
    if (applied) migrations = (await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0].count;
    const migrated = checkMigrationsApplied(migrations, journal.count);
    if (!migrated.ok) throw new Error(migrated.message);
    await assertEmpty(sql);

    log("2/6 Checking the archive.");
    const known = new Set(exportTables().map((table) => table.name));
    const listing = checkListing(await listArchive(archivePath), known);
    if (listing.problems.length > 0) throw new Error(`The archive is not safe to restore:\n  ${listing.problems.slice(0, 10).join("\n  ")}`);

    await mkdir(temp, { recursive: true });
    await extractArchive(archivePath, temp);
    const found = await inspectExtracted(temp, known);
    if (found.problems.length > 0) throw new Error(`The archive is not safe to restore:\n  ${found.problems.slice(0, 10).join("\n  ")}`);
    const manifestPath = path.join(temp, "manifest.json");
    if (!found.hasManifest || (await stat(manifestPath)).size > MANIFEST_MAX_BYTES) throw new Error("The archive has no usable manifest.json.");
    const manifest = parseManifest(await readFile(manifestPath, "utf8"));

    const compatible = compareSchemaVersions(manifest.schemaVersion, journal.version);
    if (!compatible.ok) throw new Error(compatible.message);
    log(`    Made by TechTeam ${manifest.appVersion} on ${manifest.createdAt} (schema ${manifest.schemaTag}${compatible.older ? ", older than this version: new columns take their defaults" : ""}).`);
    const present = new Set(found.tables);
    for (const name of Object.keys(manifest.tables)) {
      if (!present.has(name)) throw new Error(`The manifest lists ${name} but the archive has no rows file for it.`);
    }
    for (const name of present) {
      if (!(name in manifest.tables)) throw new Error(`The archive has rows for ${name} that the manifest does not list.`);
    }
    if (found.files.length !== manifest.fileCount) throw new Error(`The manifest says ${manifest.fileCount} files, the archive holds ${found.files.length}.`);

    const plan = planRestore(manifest, warn);

    log("3/6 Copying files.");
    const filesBase = path.join(dataDir, "files");
    let copied = 0;
    let same = 0;
    let different = 0;
    for (const file of found.files) {
      const target = keyPath(filesBase, file.key);
      if (!target) throw new Error(`Refused a file with an unsafe key: ${JSON.stringify(file.key)}`);
      if (existsSync(target)) {
        if ((await stat(target)).size === file.size && (await sha256(target)) === (await sha256(file.path))) same += 1;
        else {
          different += 1;
          warn(`${file.key} already exists here with other content: kept the existing file.`);
        }
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      const partial = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await copyFile(file.path, partial);
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true }).catch(() => undefined);
        throw error;
      }
      copied += 1;
    }
    log(`    ${copied} copied, ${same} already there (identical), ${different} kept as they were.`);

    log("4/6 Restoring rows (one transaction).");
    /** @type {Record<string, number>} */
    const restored = {};
    await sql.begin(async (tx) => {
      await tx.unsafe("LOCK TABLE public.users, public.workspaces IN SHARE ROW EXCLUSIVE MODE");
      await assertEmpty(tx);
      /** @type {Map<string, { pk: unknown; value: unknown }[]>} */
      const pending = new Map();
      for (const { table, columns, nulled } of plan.tables) {
        const file = path.join(temp, "tables", `${table.name}.jsonl`);
        const statement = insertSql(table.name, columns, nulled);
        const deferredColumns = columns.filter((column) => nulled.includes(column.name));
        let batch = [];
        let batchBytes = 0;
        let rows = 0;
        let lineNumber = 0;
        const flush = async () => {
          if (batch.length === 0) return;
          await tx.unsafe(statement, [tx.json(batch)]);
          batch = [];
          batchBytes = 0;
        };
        for await (const line of readLines(file)) {
          lineNumber += 1;
          /** @type {Record<string, unknown>} */
          let row;
          try {
            row = parseLine(columns, line);
          } catch (error) {
            throw new Error(`tables/${table.name}.jsonl line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
          }
          for (const column of deferredColumns) {
            if (row[column.name] === null) continue;
            const key = `${table.name}.${column.name}`;
            pending.set(key, [...(pending.get(key) ?? []), { pk: row[/** @type {string} */ (table.primaryKey)], value: row[column.name] }]);
          }
          batch.push(row);
          batchBytes += line.length;
          rows += 1;
          if (batch.length >= BATCH_ROWS || batchBytes >= BATCH_BYTES) await flush();
        }
        await flush();
        if (rows !== manifest.tables[table.name].rows) {
          throw new Error(`${table.name}: the file has ${rows} rows, the manifest says ${manifest.tables[table.name].rows}.`);
        }
        restored[table.name] = rows;
        log(`    ${table.name.padEnd(24)} ${String(rows).padStart(8)} rows`);
      }

      for (const { table: name, column, primaryKey, primaryKind, valueKind } of plan.deferred) {
        const pairs = pending.get(`${name}.${column}`) ?? [];
        for (let i = 0; i < pairs.length; i += BATCH_ROWS) {
          await tx.unsafe(deferredUpdateSql(name, primaryKey, column, primaryKind, valueKind), [tx.json(pairs.slice(i, i + BATCH_ROWS))]);
        }
      }

      for (const { table } of plan.tables) {
        for (const column of table.serialColumns) {
          // The next generated id is the highest restored one plus one (1 for an empty table).
          await tx.unsafe(
            `SELECT setval(pg_get_serial_sequence('public.${quote(table.name)}', '${column}'), COALESCE((SELECT max(${quote(column)}) FROM public.${quote(table.name)}), 0) + 1, false)`,
          );
        }
      }

      for (const { table } of plan.tables) {
        const [{ count }] = await tx.unsafe(`SELECT count(*)::int AS count FROM public.${quote(table.name)}`);
        if (count !== manifest.tables[table.name].rows) {
          throw new Error(`${table.name}: ${count} rows after the restore, the manifest says ${manifest.tables[table.name].rows}. Nothing was restored.`);
        }
      }
    });

    const totalRows = Object.values(restored).reduce((sum, rows) => sum + rows, 0);
    log("5/6 Row counts match the manifest; sequences continue after the highest id.");
    log(`6/6 Done. ${AFTER_RESTORE_NOTE}`);
    log(`Restored ${totalRows} rows in ${Object.keys(restored).length} tables and ${copied + same} files (${formatBytes((await stat(archivePath)).size)} archive, ${((Date.now() - started) / 1000).toFixed(1)} s).`);
    return { totalRows, tables: restored, copied, same, different };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Refuses a database that already holds data.
 * @param {import("postgres").Sql | import("postgres").TransactionSql} sql
 */
async function assertEmpty(sql) {
  const [{ users, workspaces }] = await sql`SELECT (SELECT count(*)::int FROM public.users) AS users, (SELECT count(*)::int FROM public.workspaces) AS workspaces`;
  if (users > 0 || workspaces > 0) {
    throw new Error(`This database is not empty (${users} users, ${workspaces} workspaces). A restore only fills an empty one and never overwrites: nothing was changed.`);
  }
}
