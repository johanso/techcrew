// Which names an archive may contain. An archive is untrusted input: only `manifest.json`, `tables/<table>.jsonl` and
// `files/<storage key>` are accepted, and nothing else is ever extracted into place. Pure.
import { isValidKey } from "../storage-key.mjs";

export const MAX_ENTRIES = 200_000;
const TABLE_FILE = /^tables\/([a-z][a-z0-9_]{0,62})\.jsonl$/;

/**
 * What an entry name is: the manifest, a table's rows, a stored file, or a directory that holds them.
 * Anything else (absolute paths, `..`, backslashes, drive letters, control characters, odd names) is refused.
 * @param {string} rawName the name as `tar` lists it
 * @returns {{ kind: "manifest" } | { kind: "table"; table: string } | { kind: "file"; key: string } | { kind: "directory" } | { kind: "refused"; reason: string }}
 */
export function classifyEntry(rawName) {
  if (/[\u0000-\u001f\u007f]/.test(rawName)) return { kind: "refused", reason: "control characters in the name" };
  const isDirectory = rawName.endsWith("/");
  const name = isDirectory ? rawName.slice(0, -1) : rawName;
  if (!name || name.length > 700) return { kind: "refused", reason: "empty or too long" };
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\\")) return { kind: "refused", reason: "an absolute or Windows path" };
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return { kind: "refused", reason: "an empty, `.` or `..` segment" };
  if (isDirectory) {
    return name === "tables" || name === "files" || (segments[0] === "files" && isValidKey(segments.slice(1).join("/")))
      ? { kind: "directory" }
      : { kind: "refused", reason: "a folder that is not tables or files" };
  }
  if (name === "manifest.json") return { kind: "manifest" };
  const table = TABLE_FILE.exec(name);
  if (table) return { kind: "table", table: table[1] };
  if (segments[0] === "files" && segments.length > 1) {
    const key = segments.slice(1).join("/");
    return isValidKey(key) ? { kind: "file", key } : { kind: "refused", reason: "a file whose name is not a valid storage key" };
  }
  return { kind: "refused", reason: "not manifest.json, tables/*.jsonl or files/**" };
}

/**
 * Checks a whole listing: every name accepted, the types plain files and folders, at most one of each name.
 * Returns the problems (empty = fine) and what the archive holds.
 * @param {{ name: string; type: string }[]} entries `type` is tar's: "-" file, "d" folder, anything else is refused
 * @param {Set<string>} knownTables the tables the schema registry allows
 */
export function checkListing(entries, knownTables) {
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  let manifests = 0;
  /** @type {string[]} */
  const tables = [];
  /** @type {string[]} */
  const files = [];
  if (entries.length > MAX_ENTRIES) problems.push(`more than ${MAX_ENTRIES} entries`);
  for (const entry of entries) {
    if (entry.type !== "-" && entry.type !== "d") {
      problems.push(`${JSON.stringify(entry.name)}: a link or special file (type ${entry.type})`);
      continue;
    }
    const classified = classifyEntry(entry.name);
    if (classified.kind === "refused") {
      problems.push(`${JSON.stringify(entry.name)}: ${classified.reason}`);
      continue;
    }
    if (classified.kind === "directory" !== (entry.type === "d")) {
      problems.push(`${JSON.stringify(entry.name)}: type does not match its name`);
      continue;
    }
    if (seen.has(entry.name)) {
      problems.push(`${JSON.stringify(entry.name)}: listed twice`);
      continue;
    }
    seen.add(entry.name);
    if (classified.kind === "manifest") manifests += 1;
    else if (classified.kind === "table") {
      if (knownTables.has(classified.table)) tables.push(classified.table);
      else problems.push(`${JSON.stringify(entry.name)}: not a table of this TechTeam`);
    } else if (classified.kind === "file") files.push(classified.key);
  }
  if (manifests !== 1) problems.push("the archive needs exactly one manifest.json");
  return { problems, tables, files };
}

/**
 * Pairs the plain listing (`tar -tf`: the names) with the verbose one (`tar -tvf`: its first letter per line is the
 * entry's type: `-` file, `d` folder, `l` symlink, `h` hard link …). Both tars print them in the same order.
 * @param {string} verbose
 * @param {string[]} names the plain listing, same order
 * @returns {{ name: string; type: string }[]}
 */
export function pairTypes(verbose, names) {
  const lines = verbose.split("\n").filter((line) => line.length > 0);
  if (lines.length !== names.length) throw new Error("The archive listing is inconsistent (names with line breaks?).");
  return names.map((name, index) => ({ name, type: lines[index][0] }));
}
