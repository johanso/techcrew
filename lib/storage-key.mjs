// What a storage key is, pure and shared by the app (lib/storage.ts) and the plain-node scripts (import-s3, backup,
// restore). Plain .mjs so `node` runs it with no build step and Next and Vitest import it like any module.
import path from "node:path";

/**
 * Whether a string is a safe storage key: relative, `/`-separated, no empty, `.` or `..` segment, no segment starting
 * with a dot, no NUL, backslash, drive colon or `%`.
 * @param {unknown} key
 * @returns {key is string}
 */
export function isValidKey(key) {
  if (typeof key !== "string" || !key || key.length > 512) return false;
  if (key.includes("\0") || key.includes("\\") || key.includes(":") || key.includes("%")) return false;
  return key.split("/").every((segment) => segment !== "" && !segment.startsWith("."));
}

/**
 * The absolute path of a key under `base`, or null when the key is invalid or would leave `base`.
 * @param {string} base an absolute folder
 * @param {string} key
 */
export function keyPath(base, key) {
  if (!isValidKey(key)) return null;
  const full = path.resolve(base, ...key.split("/"));
  const relative = path.relative(base, full);
  return !relative || relative.startsWith("..") || path.isAbsolute(relative) ? null : full;
}
