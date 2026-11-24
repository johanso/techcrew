// `npm run backup`: one archive with the database's rows and the stored files. The database is only ever read: one
// connection, one REPEATABLE READ READ ONLY transaction (a consistent snapshot, and Postgres refuses any write), and
// rows streamed through a cursor so a big table never sits in memory. Nothing secret is exported (registry.mjs).
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { resolveDataDir } from "../local-db-config.mjs";
import { openS3Source, s3ConfigFromEnv } from "../s3-source.mjs";
import { isValidKey } from "../storage-key.mjs";
import { activeRunsDecision, activeRunsWarning } from "./active-runs.mjs";
import { backfillGithubUserIds } from "./adoption.mjs";
import { connect, resolveDatabase } from "./connection.mjs";
import { buildManifest, latestSchemaVersion } from "./manifest.mjs";
import { AFTER_RESTORE_NOTE, excludedSummary, exportTables } from "./registry.mjs";
import { selectSql, serializeRow } from "./rows.mjs";
import { defaultArchiveName, formatBytes } from "./format.mjs";
import { createArchive } from "./tar.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CURSOR_ROWS = 500;

/** Every plain file under a folder, as `/`-separated keys. Symlinks and other special files are skipped. @param {string} base */
async function listFiles(base) {
  /** @type {string[]} */
  const keys = [];
  /** @type {string[]} */
  const skipped = [];
  /** @param {string} directory @param {string} prefix */
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      const stats = await lstat(path.join(directory, entry.name));
      if (stats.isDirectory()) await walk(path.join(directory, entry.name), `${key}/`);
      else if (stats.isFile() && !/\.[0-9a-f-]{36}\.tmp$/.test(entry.name)) keys.push(key);
      else if (!stats.isFile()) skipped.push(key);
    }
  }
  if (existsSync(base)) await walk(base, "");
  return { keys, skipped };
}

/**
 * @param {{
 *   env: Record<string, string | undefined>; out: string | null; withS3: boolean; yes: boolean; interactive: boolean;
 *   log: (message: string) => void; warn: (message: string) => void; ask: (question: string) => Promise<boolean>;
 * }} options
 */
export async function runExport({ env, out, withS3, yes, interactive, log, warn, ask }) {
  const archivePath = path.resolve(out ?? defaultArchiveName());
  if (existsSync(archivePath)) throw new Error(`${archivePath} already exists. Choose another name with --out.`);
  if (!existsSync(path.dirname(archivePath))) throw new Error(`The folder ${path.dirname(archivePath)} does not exist.`);

  /** @type {ReturnType<typeof openS3Source> | null} */
  let s3 = null;
  if (withS3) {
    const { config, missing } = s3ConfigFromEnv(env);
    if (!config) throw new Error(`--with-s3 needs ${missing.join(", ")} in the environment (S3_ENDPOINT too for a non-AWS bucket).`);
    s3 = openS3Source(config);
  }

  const { url, label } = resolveDatabase(env);
  const dataDir = resolveDataDir(env);
  const staging = path.join(dataDir, "tmp", `backup-${randomBytes(6).toString("hex")}`);
  const sql = connect(url);
  const started = Date.now();
  try {
    log(`1/5 Reading ${label} (read only).`);
    /** @type {Record<string, Set<string>>} */
    const present = {};
    for (const row of await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`) {
      (present[row.table_name] ??= new Set()).add(row.column_name);
    }

    if (present.agent_runs) {
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM public.agent_runs WHERE status IN ('queued', 'running')`;
      if (count > 0) {
        warn(activeRunsWarning(count));
        const decision = activeRunsDecision({ count, yes, interactive });
        if (decision === "refuse") throw new Error("Not continuing: run this again with --yes to back up anyway, or wait for the runs to finish.");
        if (decision === "ask" && !(await ask("Back up anyway? [y/N] "))) throw new Error("Cancelled.");
      }
    }

    await mkdir(path.join(staging, "tables"), { recursive: true });
    await mkdir(path.join(staging, "files"), { recursive: true });

    log("2/5 Exporting tables (one consistent snapshot).");
    /** @type {Record<string, { rows: number; columns: string[] }>} */
    const manifestTables = {};
    let sourceMigrations = null;
    let backfilled = 0;
    await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      const [{ applied }] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS applied`;
      if (applied) {
        const [row] = await tx`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
        sourceMigrations = row.count;
      }

      /** @type {{ userId: number; githubUserId: string }[]} */
      let connections = [];
      if (present.github_connections?.has("user_id") && present.github_connections.has("github_user_id")) {
        // Read only to give an exported user its adoption key; the table itself is never exported.
        connections = (await tx`SELECT user_id, github_user_id::text AS github_user_id FROM public.github_connections`).map((row) => ({
          userId: row.user_id,
          githubUserId: row.github_user_id,
        }));
      }

      for (const table of exportTables()) {
        const have = present[table.name];
        if (!have) {
          warn(`Table ${table.name} does not exist in this database (an older version?): skipped.`);
          continue;
        }
        const columns = table.columns.filter((column) => have.has(column.name));
        for (const column of table.columns) {
          if (!have.has(column.name)) warn(`Column ${table.name}.${column.name} does not exist in this database: left out (a restore uses its default).`);
        }
        const file = path.join(staging, "tables", `${table.name}.jsonl`);
        const stream = createWriteStream(file, { flags: "wx", mode: 0o600 });
        /** @param {Record<string, unknown>} row */
        const write = async (row) => {
          if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, "drain");
        };
        let rows = 0;
        const query = tx.unsafe(selectSql(table.name, columns, table.primaryKey ?? undefined));
        if (table.name === "users") {
          /** @type {Record<string, unknown>[]} */
          const all = [];
          for await (const batch of query.cursor(CURSOR_ROWS)) for (const row of batch) all.push(serializeRow(columns, row));
          const adopted = backfillGithubUserIds(all, connections);
          backfilled = adopted.filled;
          for (const row of adopted.users) await write(row);
          rows = adopted.users.length;
        } else {
          for await (const batch of query.cursor(CURSOR_ROWS)) {
            for (const row of batch) {
              await write(serializeRow(columns, row));
              rows += 1;
            }
          }
        }
        stream.end();
        await once(stream, "close");
        manifestTables[table.name] = { rows, columns: columns.map((column) => column.name) };
        log(`    ${table.name.padEnd(24)} ${String(rows).padStart(8)} rows`);
      }
    });
    if (backfilled > 0) log(`    ${backfilled} user${backfilled === 1 ? "" : "s"} got the GitHub id of their saved connection, so sign-in recognizes them.`);

    log("3/5 Copying files.");
    const filesBase = path.join(dataDir, "files");
    const local = await listFiles(filesBase);
    let fileCount = 0;
    let refused = local.skipped.length;
    for (const key of local.skipped) warn(`Skipped ${JSON.stringify(key)}: not a regular file.`);
    for (const key of local.keys) {
      if (!isValidKey(key)) {
        refused += 1;
        warn(`Skipped ${JSON.stringify(key)}: not a valid storage key.`);
        continue;
      }
      const target = path.join(staging, "files", ...key.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(filesBase, ...key.split("/")), target);
      fileCount += 1;
    }
    log(`    ${fileCount} file${fileCount === 1 ? "" : "s"} from ${filesBase}`);

    if (s3) {
      log("    Copying the S3 bucket (read only, nothing is deleted there).");
      let copied = 0;
      let already = 0;
      let failed = 0;
      for await (const key of s3.keys()) {
        if (!isValidKey(key)) {
          refused += 1;
          warn(`Refused unsafe S3 key: ${JSON.stringify(key)}`);
          continue;
        }
        const target = path.join(staging, "files", ...key.split("/"));
        if (await stat(target).then(() => true, () => false)) {
          already += 1;
          continue;
        }
        try {
          const bytes = await s3.read(key);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
          copied += 1;
        } catch (error) {
          failed += 1;
          warn(`Could not read ${key} from S3: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      fileCount += copied;
      log(`    S3: ${copied} copied, ${already} already in the local files, ${failed} failed.`);
      if (failed > 0) throw new Error(`${failed} S3 object${failed === 1 ? "" : "s"} could not be read: not writing an incomplete backup. Run again.`);
    }
    if (refused > 0) warn(`${refused} file${refused === 1 ? "" : "s"} left out (unsafe key or not a regular file).`);

    log("4/5 Writing the archive.");
    const journal = latestSchemaVersion(readFileSync(path.join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
    if (sourceMigrations !== null && sourceMigrations < journal.count) {
      warn(`This database has applied ${sourceMigrations} of ${journal.count} migrations (run \`npm run db:migrate\` to update it). Columns it lacks were left out.`);
    }
    const appVersion = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    const manifest = buildManifest({ appVersion, schemaVersion: journal.version, schemaTag: journal.tag, tables: manifestTables, fileCount });
    await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await createArchive(staging, archivePath);

    const size = (await stat(archivePath)).size;
    log("5/5 Done. Left out of the archive:");
    for (const line of excludedSummary()) log(`    ${line}`);
    log(`    ${AFTER_RESTORE_NOTE}`);
    const totalRows = Object.values(manifestTables).reduce((sum, table) => sum + table.rows, 0);
    log(`Backup written: ${archivePath} (${formatBytes(size)}, ${totalRows} rows in ${Object.keys(manifestTables).length} tables, ${fileCount} files, ${((Date.now() - started) / 1000).toFixed(1)} s).`);
    return { archivePath, size, totalRows, fileCount, tables: manifestTables };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

