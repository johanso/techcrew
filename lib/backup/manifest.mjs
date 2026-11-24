// An archive's manifest.json: what the archive holds and which app wrote it. The manifest of an archive is untrusted
// input, so parseManifest checks every field's shape. Pure.

export const TOOL_NAME = "techteam-backup";
export const FORMAT_VERSION = 1;
export const MANIFEST_MAX_BYTES = 1024 * 1024;

/**
 * The newest migration of a drizzle journal: its index (the schema version) and tag.
 * @param {string} journalText the text of drizzle/meta/_journal.json
 */
export function latestSchemaVersion(journalText) {
  const journal = JSON.parse(journalText);
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const last = entries.at(-1);
  if (!last || !Number.isInteger(last.idx) || typeof last.tag !== "string") throw new Error("The migration journal has no entries.");
  return { version: /** @type {number} */ (last.idx), tag: /** @type {string} */ (last.tag), count: entries.length };
}

/**
 * @typedef {{ rows: number; columns: string[] }} ManifestTable
 * @typedef {{
 *   tool: string; formatVersion: number; createdAt: string; appVersion: string;
 *   schemaVersion: number; schemaTag: string; tables: Record<string, ManifestTable>; fileCount: number;
 * }} Manifest
 */

/**
 * @param {{ appVersion: string; schemaVersion: number; schemaTag: string; tables: Record<string, ManifestTable>; fileCount: number; now?: Date }} input
 * @returns {Manifest}
 */
export function buildManifest(input) {
  return {
    tool: TOOL_NAME,
    formatVersion: FORMAT_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
    schemaTag: input.schemaTag,
    tables: input.tables,
    fileCount: input.fileCount,
  };
}

const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Reads and validates a manifest's text. Throws a message for the owner when it isn't one of ours.
 * @param {string} text
 * @returns {Manifest}
 */
export function parseManifest(text) {
  if (text.length > MANIFEST_MAX_BYTES) throw new Error("manifest.json is too large to be a TechTeam backup.");
  /** @type {Record<string, unknown> | null} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("manifest.json is not valid JSON: this is not a TechTeam backup.");
  }
  if (!raw || typeof raw !== "object" || raw.tool !== TOOL_NAME) throw new Error("This archive was not made by `npm run backup`.");
  if (raw.formatVersion !== FORMAT_VERSION) {
    throw new Error(`Backup format ${String(raw.formatVersion)} is not supported by this TechTeam (it reads format ${FORMAT_VERSION}). Update TechTeam.`);
  }
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) throw new Error("manifest.json: createdAt is not a date.");
  if (typeof raw.appVersion !== "string" || raw.appVersion.length > 64) throw new Error("manifest.json: appVersion is not valid.");
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 0) throw new Error("manifest.json: schemaVersion is not valid.");
  if (typeof raw.schemaTag !== "string" || raw.schemaTag.length > 128) throw new Error("manifest.json: schemaTag is not valid.");
  if (!Number.isInteger(raw.fileCount) || raw.fileCount < 0) throw new Error("manifest.json: fileCount is not valid.");
  if (!raw.tables || typeof raw.tables !== "object" || Array.isArray(raw.tables)) throw new Error("manifest.json: tables is not valid.");
  /** @type {Record<string, ManifestTable>} */
  const tables = {};
  for (const [name, table] of Object.entries(raw.tables)) {
    const entry = /** @type {Record<string, unknown> | null} */ (table);
    if (!TABLE_NAME.test(name)) throw new Error(`manifest.json: ${JSON.stringify(name)} is not a table name.`);
    if (!entry || !Number.isInteger(entry.rows) || entry.rows < 0) throw new Error(`manifest.json: the row count of ${name} is not valid.`);
    if (!Array.isArray(entry.columns) || entry.columns.length > 200 || entry.columns.some((c) => typeof c !== "string" || !TABLE_NAME.test(c))) {
      throw new Error(`manifest.json: the columns of ${name} are not valid.`);
    }
    tables[name] = { rows: entry.rows, columns: entry.columns };
  }
  return {
    tool: TOOL_NAME,
    formatVersion: FORMAT_VERSION,
    createdAt: raw.createdAt,
    appVersion: raw.appVersion,
    schemaVersion: raw.schemaVersion,
    schemaTag: raw.schemaTag,
    tables,
    fileCount: raw.fileCount,
  };
}

/**
 * Whether this app can restore an archive of that schema version. Newer is refused (a column this app doesn't know
 * could hold data it would drop); older is fine (missing columns take their defaults).
 * @param {number} archiveVersion @param {number} appVersion
 * @returns {{ ok: true; older: boolean } | { ok: false; message: string }}
 */
export function compareSchemaVersions(archiveVersion, appVersion) {
  if (archiveVersion > appVersion) {
    return {
      ok: false,
      message: `This backup was made by a newer TechTeam (schema ${archiveVersion}, this one knows ${appVersion}). Update TechTeam, then restore again.`,
    };
  }
  return { ok: true, older: archiveVersion < appVersion };
}

/**
 * Whether the target database has applied every migration of this app: drizzle records one row per applied migration.
 * @param {number | null} applied rows in drizzle.__drizzle_migrations, null when the table doesn't exist
 * @param {number} needed the app's migrations
 * @returns {{ ok: true } | { ok: false; message: string }}
 */
export function checkMigrationsApplied(applied, needed) {
  if (applied !== null && applied >= needed) return { ok: true };
  return { ok: false, message: "The database does not have this version's tables yet. Run `npm run db:migrate` (the embedded database does it when it starts), then restore again." };
}
