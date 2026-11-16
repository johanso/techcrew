#!/usr/bin/env node
/**
 * Vendors the built-in agent skills listed in agent-skills/sources.json into agent-skills/<slug>/, exactly as
 * published at the pinned commit, and regenerates agent-skills/catalog.json (what the app reads for the library and
 * for search). Updates arrive as a reviewable diff: run this, read the diff, open a pull request.
 *
 *   npm run skills:sync                       # re-download every source at its pinned ref
 *   npm run skills:sync -- modern-web-guidance  # only these slugs
 *   npm run skills:sync -- --update [slug…]   # move the pinned ref to the repository's latest commit first
 *
 * Safety: downloads the public codeload tarball (no token, no new dependencies), keeps only text files (.md, .txt and
 * the upstream LICENSE/NOTICE), rejects unsafe paths, skips links, and never runs anything from the download.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "agent-skills");
const SOURCES = join(SKILLS_DIR, "sources.json");
const CATALOG = join(SKILLS_DIR, "catalog.json");

const TEXT_FILE = /\.(md|txt)$/i;
const SEGMENT = /^[A-Za-z0-9._ -]+$/;
const SHA = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const SUMMARY_MAX = 240;
// Files TechTeam writes next to the skill; not part of the skill's content.
const META_FILES = new Set(["SOURCE.md", "LICENSE", "NOTICE"]);

// ── Tar (ustar + pax/GNU long names), enough for GitHub's codeload tarballs ──

function cString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function paxPath(data) {
  let offset = 0;
  const text = data.toString("utf8");
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space === -1) break;
    const length = Number(text.slice(offset, space));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length - 1);
    const eq = record.indexOf("=");
    if (record.slice(0, eq) === "path") return record.slice(eq + 1);
    offset += length;
  }
  return null;
}

function* tarEntries(buf) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    if (header[124] & 0x80) throw new Error("Tar entry too large (base-256 size).");
    const size = parseInt(cString(header, 124, 12).trim() || "0", 8);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    const data = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "g") continue;
    if (type === "x") {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (type === "L") {
      longName = cString(data, 0, data.length);
      continue;
    }
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    yield { path, type, data };
  }
}

/** A path inside the skill folder, or a reason it's refused. */
function safeRelative(path) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.length > 300) return { error: "unsafe path" };
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !SEGMENT.test(part))) return { error: "unsafe path" };
  return { path };
}

// ── Frontmatter and search metadata (mirrors lib/skill-format.ts; a unit test checks they agree) ──

function unquote(value) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => ({ n: "\n", t: "\t" })[c] ?? c);
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, "");
}

/** name + description from SKILL.md's frontmatter (top-level scalars, block scalars and folded plain scalars). */
function frontmatter(text) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, body: text };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return { data: {}, body: text };
  const data = {};
  for (let i = 1; i < end; i++) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, key, rest] = match;
    const raw = rest.trim();
    const block = [];
    while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s/.test(lines[i + 1]))) block.push(lines[++i]);
    const header = /^([|>])([+-]?)$/.exec(raw);
    if (header) {
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      data[key] = header[1] === "|" ? body.join("\n").trim() : foldLines(body);
    } else if (raw) {
      data[key] = block.length && !raw.startsWith('"') && !raw.startsWith("'") ? foldLines([raw, ...block.map((l) => l.trim())]) : unquote(raw);
    }
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

function foldLines(lines) {
  return lines
    .map((l) => l.trim())
    .join("\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function plain(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Title and a short summary of one skill file, for search. */
function docMeta(path, content) {
  const { data, body } = frontmatter(content);
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const heading = lines.find((line) => /^#\s+\S/.test(line));
  const fileName = path.split("/").pop().replace(/\.(md|txt)$/i, "");
  const title = clip(plain(typeof data.name === "string" && path === "SKILL.md" ? data.name : heading ? heading.replace(/^#\s+/, "") : fileName), 120);
  let summary = typeof data.description === "string" ? data.description : "";
  if (!summary) {
    const paragraph = [];
    let fenced = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced || /^\s*(```|~~~)/.test(line)) {
        if (paragraph.length) break;
        continue;
      }
      if (/^\s*#/.test(line) || /^\s*([-*]{3,}|<!--.*-->)\s*$/.test(line)) {
        if (paragraph.length) break;
        continue;
      }
      if (!line.trim()) {
        if (paragraph.length) break;
        continue;
      }
      paragraph.push(line);
    }
    summary = paragraph.join(" ");
  }
  return { title, summary: clip(plain(summary), SUMMARY_MAX) };
}

/** Content version: sha256 over the sorted files (path, NUL, content, NUL), first 12 hex characters. */
function contentVersion(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

// ── Download ───────────────────────────────────────────────────────────────────

async function fetchOk(url) {
  const response = await fetch(url, { headers: { "User-Agent": "techteam-skills-sync" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function latestCommit(repo) {
  const response = await fetchOk(`https://api.github.com/repos/${repo}/commits/HEAD`);
  const { sha } = await response.json();
  if (!SHA.test(sha)) throw new Error(`${repo}: unexpected commit id`);
  return sha;
}

async function download(source) {
  const response = await fetchOk(`https://codeload.github.com/${source.repo}/tar.gz/${source.ref}`);
  const tar = gunzipSync(Buffer.from(await response.arrayBuffer()), { maxOutputLength: 512 * 1024 * 1024 });
  const skillPrefix = `${source.path.replace(/\/+$/, "")}/`;
  const files = [];
  const ignored = [];
  let license = null;
  let totalBytes = 0;

  for (const entry of tarEntries(tar)) {
    // codeload wraps everything in "<repo>-<sha>/".
    const inRepo = entry.path.split("/").slice(1).join("/");
    if (entry.type === "5" || !inRepo) continue;
    if (inRepo === source.licenseFile && entry.type === "0") {
      license = entry.data.toString("utf8");
      continue;
    }
    if (!inRepo.startsWith(skillPrefix)) continue;
    const rel = inRepo.slice(skillPrefix.length);
    if (entry.type !== "0") {
      ignored.push(`${rel} (link or special file)`);
      continue;
    }
    const safe = safeRelative(rel);
    if (safe.error) {
      ignored.push(`${rel} (${safe.error})`);
      continue;
    }
    if (!TEXT_FILE.test(rel) || META_FILES.has(rel)) {
      ignored.push(`${rel} (not a text file)`);
      continue;
    }
    const content = entry.data.toString("utf8");
    if (content.includes("\0")) {
      ignored.push(`${rel} (binary)`);
      continue;
    }
    totalBytes += entry.data.length;
    files.push({ path: safe.path, content });
  }
  if (!files.some((f) => f.path === "SKILL.md")) throw new Error(`${source.slug}: no SKILL.md at ${source.path}`);
  if (files.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) throw new Error(`${source.slug}: too large (${files.length} files, ${totalBytes} bytes)`);
  if (!license) throw new Error(`${source.slug}: license file ${source.licenseFile} not found`);
  return { files, ignored, license, totalBytes };
}

function sourceDoc(source, { files, ignored, totalBytes }, version) {
  return `# ${source.slug}

Vendored by \`npm run skills:sync\` (scripts/sync-agent-skills.mjs). Do not edit the files in this folder by hand:
change the pinned ref in \`agent-skills/sources.json\`, run the sync and review the diff in a pull request.

| | |
| --- | --- |
| Origin | https://github.com/${source.repo}/tree/${source.ref}/${source.path} |
| Repository | ${source.repo} |
| Path | ${source.path} |
| Pinned commit | ${source.ref} |
| License | ${source.license} (upstream \`${source.licenseFile}\`, copied as \`LICENSE\`) |
| Files | ${files.length} text files, ${totalBytes.toLocaleString("en-US")} bytes |
| Content version | ${version} |
| Synced | ${new Date().toISOString().slice(0, 10)} |

Ignored files (not text, links or unsafe paths): ${ignored.length ? `\n\n${ignored.map((p) => `- ${p}`).join("\n")}` : "none."}
`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function validateSource(source) {
  for (const field of ["slug", "repo", "path", "ref", "license", "licenseFile", "type", "load"]) {
    if (typeof source[field] !== "string" || !source[field]) throw new Error(`sources.json: ${source.slug ?? "?"} needs "${field}"`);
  }
  if (!SLUG.test(source.slug)) throw new Error(`sources.json: invalid slug ${source.slug}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.repo)) throw new Error(`sources.json: invalid repo ${source.repo}`);
  if (!SHA.test(source.ref)) throw new Error(`sources.json: ${source.slug} ref must be a full commit SHA`);
  if (!["technical", "practice"].includes(source.type)) throw new Error(`sources.json: ${source.slug} type must be technical or practice`);
  if (!["always", "on_demand"].includes(source.load)) throw new Error(`sources.json: ${source.slug} load must be always or on_demand`);
  if (source.path.split("/").some((part) => !part || part === "..")) throw new Error(`sources.json: ${source.slug} has an unsafe path`);
}

async function readSkillFolder(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readSkillFolder(full, base)));
    else if (entry.isFile()) out.push({ path: relative(base, full).split("\\").join("/"), content: await readFile(full, "utf8") });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const only = args.filter((a) => !a.startsWith("--"));
  const manifest = JSON.parse(await readFile(SOURCES, "utf8"));
  const sources = manifest.skills;
  sources.forEach(validateSource);
  const unknown = only.filter((slug) => !sources.some((s) => s.slug === slug));
  if (unknown.length) throw new Error(`Unknown slug(s): ${unknown.join(", ")}`);
  const selected = sources.filter((s) => !only.length || only.includes(s.slug));

  if (update) {
    for (const source of selected) {
      const sha = await latestCommit(source.repo);
      if (sha !== source.ref) console.log(`${source.slug}: ${source.ref.slice(0, 7)} → ${sha.slice(0, 7)}`);
      source.ref = sha;
    }
    await writeFile(SOURCES, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  for (const source of selected) {
    const result = await download(source);
    const version = contentVersion(result.files);
    const tmp = join(SKILLS_DIR, `.${source.slug}.tmp`);
    await rm(tmp, { recursive: true, force: true });
    for (const file of result.files) {
      await mkdir(dirname(join(tmp, file.path)), { recursive: true });
      await writeFile(join(tmp, file.path), file.content);
    }
    await writeFile(join(tmp, "LICENSE"), result.license);
    await writeFile(join(tmp, "SOURCE.md"), sourceDoc(source, result, version));
    await rm(join(SKILLS_DIR, source.slug), { recursive: true, force: true });
    await rename(tmp, join(SKILLS_DIR, source.slug));
    console.log(`${source.slug}: ${result.files.length} files, ${result.totalBytes} bytes, version ${version}${result.ignored.length ? `, ${result.ignored.length} ignored` : ""}`);
  }

  // The catalog always covers every source, from what's on disk.
  const catalog = [];
  for (const source of sources) {
    const dir = join(SKILLS_DIR, source.slug);
    if (!existsSync(dir)) throw new Error(`${source.slug} isn't vendored yet: run npm run skills:sync -- ${source.slug}`);
    const files = (await readSkillFolder(dir)).filter((f) => !META_FILES.has(f.path) && TEXT_FILE.test(f.path));
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const skill = files.find((f) => f.path === "SKILL.md");
    const { data } = frontmatter(skill.content);
    catalog.push({
      slug: source.slug,
      name: data.name ?? source.slug,
      description: data.description ?? "",
      type: source.type,
      load: source.load,
      roles: source.roles ?? [],
      requires: source.requires ?? [],
      license: source.license,
      origin: `${source.repo}@${source.ref.slice(0, 7)}`,
      url: `https://github.com/${source.repo}/tree/${source.ref}/${source.path}`,
      usage: source.usage ?? "",
      version: contentVersion(files),
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0),
      files: files.map((f) => ({ path: f.path, ...docMeta(f.path, f.content), bytes: Buffer.byteLength(f.content) })),
    });
  }
  await writeFile(
    CATALOG,
    `${JSON.stringify({ $comment: "Generated by scripts/sync-agent-skills.mjs from agent-skills/sources.json. Do not edit.", skills: catalog }, null, 2)}\n`
  );
  console.log(`catalog.json: ${catalog.length} skills`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
