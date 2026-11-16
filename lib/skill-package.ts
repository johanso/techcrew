import { UPLOAD_FILES_MAX, UPLOAD_MAX_BYTES, UPLOAD_TEXT_MAX_BYTES, formatBytes } from "@/lib/agent-skills-config";
import { cleanSkillPath, contentVersion, docMeta, isSkillTextFile, parseSkillMarkdown, type SkillManifest } from "@/lib/skill-format";
import { ZipError, listZip, readZipEntry } from "@/lib/skill-zip";

/**
 * Turns an upload (a single SKILL.md, or a .zip with SKILL.md at its root or one folder deep) into a validated skill
 * package: text files only, safe paths, within the limits. Nothing in it is ever executed.
 */

export type SkillFile = { path: string; content: string; title: string; summary: string; size: number };

export type SkillPackage = {
  manifest: SkillManifest;
  files: SkillFile[];
  /** Files left out, with why (not text, outside the skill folder, system files). */
  ignored: string[];
  totalBytes: number;
  version: string;
};

export type PackageResult = { ok: true; pkg: SkillPackage } | { ok: false; error: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });
// Archive noise from macOS and Windows; listed as ignored, never an error.
const SYSTEM_FILE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

function decode(bytes: Uint8Array): string | null {
  try {
    const text = utf8.decode(bytes);
    return text.includes("\0") ? null : text.replace(/^﻿/, "");
  } catch {
    return null;
  }
}

function build(manifestText: string, raw: { path: string; content: string }[], ignored: string[]): PackageResult {
  const parsed = parseSkillMarkdown(manifestText);
  if (!parsed.ok) return parsed;
  const files = raw
    .map((f) => ({ path: f.path, content: f.content, size: Buffer.byteLength(f.content), ...docMeta(f.path, f.content) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > UPLOAD_TEXT_MAX_BYTES) return { ok: false, error: `The skill's text files add up to ${formatBytes(totalBytes)}; the limit is ${formatBytes(UPLOAD_TEXT_MAX_BYTES)}.` };
  return { ok: true, pkg: { manifest: parsed.skill, files, ignored, totalBytes, version: contentVersion(files) } };
}

/** A single markdown upload is the skill's SKILL.md, whatever the file was called. */
function fromMarkdown(bytes: Buffer): PackageResult {
  if (bytes.length > UPLOAD_TEXT_MAX_BYTES) return { ok: false, error: `SKILL.md is larger than ${formatBytes(UPLOAD_TEXT_MAX_BYTES)}.` };
  const text = decode(bytes);
  if (text === null) return { ok: false, error: "The file isn't UTF-8 text." };
  return build(text, [{ path: "SKILL.md", content: text }], []);
}

function fromZip(bytes: Buffer): PackageResult {
  const entries = listZip(bytes);
  for (const entry of entries) {
    if (SYSTEM_FILE.test(entry.path)) continue;
    if (!cleanSkillPath(entry.path.replace(/\/$/, ""))) return { ok: false, error: `The archive contains an unsafe path (${entry.path.slice(0, 120)}). Paths must be relative, without “..”.` };
    if (entry.kind === "symlink") return { ok: false, error: `The archive contains a symbolic link (${entry.path.slice(0, 120)}). Links aren't allowed.` };
  }
  const manifests = entries.filter((e) => e.kind === "file" && !SYSTEM_FILE.test(e.path) && /^([^/]+\/)?SKILL\.md$/.test(e.path));
  if (!manifests.length) return { ok: false, error: "No SKILL.md found. Put it at the root of the .zip or in one top-level folder." };
  const root = manifests.some((e) => e.path === "SKILL.md") ? "" : manifests.length === 1 ? manifests[0]!.path.slice(0, -"SKILL.md".length) : null;
  if (root === null) return { ok: false, error: "The archive holds more than one skill. Upload one skill (one SKILL.md) at a time." };

  const ignored: string[] = [];
  const kept: typeof entries = [];
  for (const entry of entries) {
    if (entry.kind === "directory") continue;
    const label = entry.path.slice(0, 160);
    if (SYSTEM_FILE.test(entry.path)) ignored.push(`${label} (system file)`);
    else if (!entry.path.startsWith(root)) ignored.push(`${label} (outside the skill folder)`);
    else if (entry.path.slice(root.length).split("/").some((part) => part.startsWith("."))) ignored.push(`${label} (hidden file)`);
    else if (!isSkillTextFile(entry.path)) ignored.push(`${label} (not a .md or .txt file)`);
    else kept.push(entry);
  }
  if (kept.length > UPLOAD_FILES_MAX) return { ok: false, error: `The skill has ${kept.length} text files; the limit is ${UPLOAD_FILES_MAX}.` };
  // Declared sizes first, so an oversized archive is refused before anything is inflated (reads are capped to them).
  const declared = kept.reduce((sum, e) => sum + e.size, 0);
  if (declared > UPLOAD_TEXT_MAX_BYTES) return { ok: false, error: `The skill's text files add up to ${formatBytes(declared)}; the limit is ${formatBytes(UPLOAD_TEXT_MAX_BYTES)}.` };

  const files: { path: string; content: string }[] = [];
  for (const entry of kept) {
    const content = decode(readZipEntry(bytes, entry));
    const path = entry.path.slice(root.length);
    if (content === null) ignored.push(`${entry.path.slice(0, 160)} (not UTF-8 text)`);
    else files.push({ path, content });
  }
  const manifest = files.find((f) => f.path === "SKILL.md");
  if (!manifest) return { ok: false, error: "SKILL.md isn't UTF-8 text." };
  return build(manifest.content, files, ignored);
}

/** Reads an uploaded skill. Errors are user-facing sentences. */
export function readSkillPackage(fileName: string, bytes: Buffer): PackageResult {
  if (!bytes.length) return { ok: false, error: "The file is empty." };
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, error: `The file is larger than ${formatBytes(UPLOAD_MAX_BYTES)}.` };
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return fromMarkdown(bytes);
  if (!lower.endsWith(".zip")) return { ok: false, error: "Upload a SKILL.md file or a .zip with the skill folder." };
  try {
    return fromZip(bytes);
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, error: error.message };
    throw error;
  }
}
