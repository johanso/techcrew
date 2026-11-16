import { createHash } from "node:crypto";

import { SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, SKILL_TEXT_EXTENSIONS } from "@/lib/agent-skills-config";

/**
 * The Agent Skills file format: SKILL.md frontmatter (a small YAML subset), name and description rules, safe paths,
 * and the search metadata of each file. Pure; scripts/sync-agent-skills.mjs mirrors frontmatter/docMeta/contentVersion
 * for the built-ins and a unit test checks both agree on the vendored files.
 */

export type FrontmatterValue = string | string[] | Record<string, string | string[]>;
export type Frontmatter = Record<string, FrontmatterValue>;

const KEY = /^([A-Za-z0-9_-]+):(.*)$/;

function unquote(value: string) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => ({ n: "\n", t: "\t" })[c] ?? c);
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, "");
}

function foldLines(lines: string[]) {
  return lines
    .map((l) => l.trim())
    .join("\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function inlineList(raw: string) {
  return raw
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

/** A value with its indented continuation lines: block scalar, block list, nested map, inline list or plain scalar. */
function parseValue(raw: string, block: string[], nested: boolean): FrontmatterValue {
  const header = /^([|>])([+-]?)$/.exec(raw);
  const content = block.filter((l) => l.trim());
  if (header) {
    const indent = Math.min(...content.map((l) => l.length - l.trimStart().length));
    const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
    return header[1] === "|" ? body.join("\n").trim() : foldLines(body);
  }
  if (raw.startsWith("[") && raw.endsWith("]")) return inlineList(raw);
  if (!raw && content.length && content.every((l) => /^\s*- /.test(l) || l.trim() === "-")) {
    return content.map((l) => unquote(l.trim().replace(/^-\s*/, "")));
  }
  if (!raw && content.length && !nested) {
    const map: Record<string, string | string[]> = {};
    const indent = Math.min(...content.map((l) => l.length - l.trimStart().length));
    const lines = block.map((l) => (l.trim() ? l.slice(indent) : ""));
    for (let i = 0; i < lines.length; i++) {
      const match = KEY.exec(lines[i]!);
      if (!match) continue;
      const inner: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1] === "" || /^\s/.test(lines[i + 1]!))) inner.push(lines[++i]!);
      const value = parseValue(match[2]!.trim(), inner, true);
      if (typeof value === "string" || Array.isArray(value)) map[match[1]!] = value;
    }
    return map;
  }
  if (raw && content.length && !raw.startsWith('"') && !raw.startsWith("'")) return foldLines([raw, ...block.map((l) => l.trim())]);
  return unquote(raw);
}

/** Splits `---` YAML frontmatter from the markdown body. Supports the subset skills use; anything else is ignored. */
export function parseFrontmatter(text: string): { data: Frontmatter; body: string; hasFrontmatter: boolean } {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, body: text, hasFrontmatter: false };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return { data: {}, body: text, hasFrontmatter: false };
  const data: Frontmatter = {};
  for (let i = 1; i < end; i++) {
    const match = KEY.exec(lines[i]!);
    if (!match) continue;
    const block: string[] = [];
    while (i + 1 < end && (lines[i + 1]!.trim() === "" || /^\s/.test(lines[i + 1]!))) block.push(lines[++i]!);
    const value = parseValue(match[2]!.trim(), block, false);
    if (value !== "" && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)) data[match[1]!] = value;
  }
  return { data, body: lines.slice(end + 1).join("\n"), hasFrontmatter: true };
}

export type SkillManifest = {
  name: string;
  description: string;
  license: string | null;
  metadata: Record<string, string | string[]>;
  /** SKILL.md without its frontmatter. */
  body: string;
};

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** SKILL.md checked against the Agent Skills rules: frontmatter with a valid name and description. */
export function parseSkillMarkdown(text: string): { ok: true; skill: SkillManifest } | { ok: false; error: string } {
  const { data, body, hasFrontmatter } = parseFrontmatter(text);
  if (!hasFrontmatter) return { ok: false, error: "SKILL.md must start with YAML frontmatter (--- name: … description: … ---)." };
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return { ok: false, error: "SKILL.md frontmatter needs a name." };
  if (name.length > SKILL_NAME_MAX || !NAME.test(name)) {
    return { ok: false, error: `The skill name “${name.slice(0, 80)}” must be lowercase letters, digits and single hyphens, at most ${SKILL_NAME_MAX} characters.` };
  }
  const description = typeof data.description === "string" ? data.description.trim() : "";
  if (!description) return { ok: false, error: "SKILL.md frontmatter needs a description." };
  if (description.length > SKILL_DESCRIPTION_MAX) return { ok: false, error: `The description is longer than ${SKILL_DESCRIPTION_MAX} characters.` };
  const metadata = typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {};
  const license = typeof data.license === "string" ? data.license.trim().slice(0, 200) || null : null;
  return { ok: true, skill: { name, description, license, metadata, body: body.trim() } };
}

const SEGMENT = /^[A-Za-z0-9._ -]+$/;

/** A relative path inside a skill folder, or null when it's unsafe (absolute, `..`, backslashes, odd characters). */
export function cleanSkillPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\.\//, "");
  if (!trimmed || trimmed.length > 300 || trimmed.startsWith("/") || trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) return null;
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !SEGMENT.test(part))) return null;
  return trimmed;
}

export function isSkillTextFile(path: string) {
  const lower = path.toLowerCase();
  return SKILL_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ── Search metadata ────────────────────────────────────────────────────────────

const SUMMARY_MAX = 240;

function plain(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const FENCE = /^\s*(```|~~~)/;

/** Title (frontmatter name for SKILL.md, else the first `# ` heading, else the file name) and a short summary. */
export function docMeta(path: string, content: string) {
  const { data, body } = parseFrontmatter(content);
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const heading = lines.find((line) => /^#\s+\S/.test(line));
  const fileName = (path.split("/").pop() ?? path).replace(/\.(md|txt)$/i, "");
  const title = clip(plain(typeof data.name === "string" && path === "SKILL.md" ? data.name : heading ? heading.replace(/^#\s+/, "") : fileName), 120);
  let summary = typeof data.description === "string" ? data.description : "";
  if (!summary) {
    const paragraph: string[] = [];
    let fenced = false;
    for (const line of lines) {
      if (FENCE.test(line)) fenced = !fenced;
      if (fenced || FENCE.test(line)) {
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
export function contentVersion(files: { path: string; content: string }[]) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
