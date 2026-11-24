import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Local file storage for workspace logos, the Tester's browser screenshots and card references. Files live under the
 * data folder (`TECHTEAM_DATA_DIR`, default `~/.techteam/data`) in `files/<key>`. A key is an app-generated relative
 * path with `/` separators (the database only ever holds keys, never absolute paths). Files are served through
 * ownership-checked routes (app/api/workspaces/[id]/logo, app/api/runs/…/screenshot,
 * app/api/workspaces/[id]/references/[referenceId]), and reference images reach model providers as base64, never as a URL.
 */

export const LOGO_MAX_BYTES = 1024 * 1024;
// SVG is excluded on purpose: it can carry scripts and is served from our origin.
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as const;

// Derived from the key's extension (every key is generated here with one of these), so no metadata is stored.
const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain; charset=utf-8",
};

/** The folder holding the files: `$TECHTEAM_DATA_DIR/files`, else `~/.techteam/data/files`. */
export function filesDir() {
  const dataDir = process.env.TECHTEAM_DATA_DIR?.trim() || path.join(homedir(), ".techteam", "data");
  return path.resolve(dataDir, "files");
}

/** Whether a string is a safe storage key: relative, `/`-separated, no empty, `.` or `..` segment, no NUL, backslash, drive or `%`. */
export function isValidKey(key: string) {
  if (!key || key.length > 512) return false;
  if (key.includes("\0") || key.includes("\\") || key.includes(":") || key.includes("%")) return false;
  return key.split("/").every((segment) => segment !== "" && !segment.startsWith("."));
}

/** The absolute path of a key, checked to stay inside the files folder. Throws on a bad key. */
function resolveKey(key: string) {
  if (!isValidKey(key)) throw new Error("Invalid storage key.");
  const base = filesDir();
  const full = path.resolve(base, ...key.split("/"));
  const relative = path.relative(base, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid storage key.");
  return { base, full };
}

function contentTypeOf(key: string) {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSION_TYPES[ext] ?? "application/octet-stream";
}

async function writeObject(key: string, bytes: Uint8Array) {
  const { full } = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  // Written beside the target and renamed, so a reader never sees half a file.
  const temp = `${full}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await rename(temp, full);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function isAllowedLogoType(type: string): type is keyof typeof LOGO_TYPES {
  return type in LOGO_TYPES;
}

export async function uploadWorkspaceLogo(ownerId: number, file: File) {
  if (!isAllowedLogoType(file.type)) throw new Error(`Unsupported logo type: ${file.type}`);
  const key = `workspace-logos/${ownerId}/${randomUUID()}.${LOGO_TYPES[file.type]}`;
  await writeObject(key, new Uint8Array(await file.arrayBuffer()));
  return key;
}

/**
 * A run's screenshot key: run-screenshots/<workspaceId>/<runId>/<uuid>.png. Built from the run's own ids, so an id
 * from a conversation (a screenshot placeholder, lib/reference-images.ts) can only name a file of that run.
 */
export const runScreenshotKey = (workspaceId: number, runId: number, id: string) => `run-screenshots/${workspaceId}/${runId}/${id}.png`;

/**
 * A browse_preview screenshot (the Tester's browser), under its workspace and run. Served only to the workspace owner
 * (app/api/runs/[runId]/steps/[stepId]/screenshot). The caller checked that the bytes are a PNG.
 */
export async function uploadRunScreenshot(workspaceId: number, runId: number, png: Uint8Array) {
  const key = runScreenshotKey(workspaceId, runId, randomUUID());
  await writeObject(key, png);
  return key;
}

/**
 * A card reference's file, or a PDF reference's extracted text (`ext` "txt"), under its workspace and card:
 * card-references/<workspaceId>/<taskId>/<uuid>.<ext>. The caller validated the bytes (lib/reference-config.ts).
 * The served type comes from the reference's row, so `contentType` is not stored.
 */
export async function uploadCardReference(input: { workspaceId: number; taskId: number; ext: string; contentType: string; bytes: Uint8Array }) {
  if (!/^[a-z0-9]{1,8}$/.test(input.ext)) throw new Error("Invalid file extension.");
  const key = `card-references/${input.workspaceId}/${input.taskId}/${randomUUID()}.${input.ext}`;
  await writeObject(key, input.bytes);
  return key;
}

/** Deletes a file. A missing file is not an error. */
export async function deleteObject(key: string) {
  const { full } = resolveKey(key);
  await rm(full, { force: true });
}

/** Reads a file, or null when it doesn't exist or resolves (through a symlink) outside the files folder. */
export async function readObject(key: string) {
  const { base, full } = resolveKey(key);
  let real: string;
  try {
    real = await realpath(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const relative = path.relative(await realpath(base), real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    return { bytes: new Uint8Array(await readFile(real)), contentType: contentTypeOf(key) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw error;
  }
}
