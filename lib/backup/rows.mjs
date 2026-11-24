// Rows in an archive: one JSON object per line. Postgres does the type conversion in both directions (the select asks
// for JSON-friendly values, the insert reads them back with jsonb_populate_recordset), so a value comes back exactly as
// it was stored: timestamps keep their microseconds, bigints travel as strings, jsonb and arrays stay structured.
// The functions here build the SQL (identifiers come only from the schema registry, never from an archive) and check
// every value of an untrusted line against its column's kind. Pure.

/** @param {string} identifier */
export const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * The select of one table: its exported columns, each as a value JSON can carry. bigint becomes text (a JS number
 * would lose digits past 2^53); everything else goes through to_jsonb (timestamps as ISO text, arrays as JSON arrays).
 * @param {string} table
 * @param {{ name: string; kind: string }[]} columns
 * @param {string} [order]
 */
export function selectSql(table, columns, order) {
  const list = columns.map((column) => `${column.kind === "bigint" ? `${quote(column.name)}::text` : `to_jsonb(${quote(column.name)})`} AS ${quote(column.name)}`);
  return `SELECT ${list.join(", ")} FROM public.${quote(table)}${order ? ` ORDER BY ${quote(order)}` : ""}`;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BIGINT = /^-?\d{1,19}$/;

/**
 * Checks one value against its column's kind and returns what goes in the archive (or what the insert reads).
 * Throws with the column's name for a value of the wrong shape.
 * @param {{ name: string; kind: string; notNull: boolean }} column
 * @param {unknown} value
 */
export function checkValue(column, value) {
  if (value === null || value === undefined) {
    if (column.notNull) throw new Error(`${column.name} is null but the column is required`);
    return null;
  }
  const fail = () => {
    throw new Error(`${column.name}: a value that is not a valid ${column.kind}`);
  };
  switch (column.kind) {
    case "serial":
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 2147483647) fail();
      return value;
    case "bigint":
      if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
      if (typeof value !== "string" || !BIGINT.test(value)) fail();
      return value;
    case "text":
      if (typeof value !== "string" || value.includes("\0")) fail();
      return value;
    case "boolean":
      if (typeof value !== "boolean") fail();
      return value;
    case "timestamp":
      if (typeof value !== "string" || !TIMESTAMP.test(value)) fail();
      return value;
    case "date":
      if (typeof value !== "string" || !DATE.test(value)) fail();
      return value;
    case "array":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.includes("\0"))) fail();
      return value;
    case "jsonb":
      return value;
    default:
      throw new Error(`${column.name}: unknown column kind ${column.kind}`);
  }
}

/**
 * A database row (as the select returns it) as the object written to the archive: exactly the exported columns, each
 * checked. A bigint that arrives as a number is written as a string.
 * @param {{ name: string; kind: string; notNull: boolean }[]} columns
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function serializeRow(columns, row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const column of columns) out[column.name] = checkValue(column, row[column.name]);
  return out;
}

/**
 * A line of an archive as a row to insert: only the wanted columns (extra keys are ignored), each checked. A column
 * the line lacks is absent from the result, so the insert leaves it to its default when it isn't wanted at all.
 * @param {{ name: string; kind: string; notNull: boolean }[]} columns
 * @param {string} line
 * @returns {Record<string, unknown>}
 */
export function parseLine(columns, line) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("a line that is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("a line that is not an object");
  const source = /** @type {Record<string, unknown>} */ (parsed);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const column of columns) out[column.name] = checkValue(column, Object.hasOwn(source, column.name) ? source[column.name] : null);
  return out;
}

/**
 * The insert of a batch: `$1` is the batch as a JSON array. `nulled` are columns inserted as null here and set later
 * (foreign keys that close a cycle).
 * @param {string} table
 * @param {{ name: string }[]} columns
 * @param {string[]} [nulled]
 */
export function insertSql(table, columns, nulled = []) {
  const names = columns.map((column) => quote(column.name)).join(", ");
  const values = columns.map((column) => (nulled.includes(column.name) ? "NULL" : `r.${quote(column.name)}`)).join(", ");
  return `INSERT INTO public.${quote(table)} (${names}) SELECT ${values} FROM jsonb_populate_recordset(NULL::public.${quote(table)}, $1::jsonb) AS r`;
}

/**
 * The update that sets a deferred foreign key once its target exists: `$1` is a JSON array of `{ pk, value }`.
 * @param {string} table
 * @param {string} primaryKey
 * @param {string} column
 * @param {"serial" | "integer" | "bigint" | "text"} pkKind
 * @param {"integer" | "bigint"} valueKind
 */
export function deferredUpdateSql(table, primaryKey, column, pkKind, valueKind) {
  const pgType = (/** @type {string} */ kind) => (kind === "bigint" ? "bigint" : kind === "text" ? "text" : "integer");
  return (
    `UPDATE public.${quote(table)} AS t SET ${quote(column)} = v.value ` +
    `FROM jsonb_to_recordset($1::jsonb) AS v(pk ${pgType(pkKind)}, value ${pgType(valueKind)}) WHERE t.${quote(primaryKey)} = v.pk`
  );
}
