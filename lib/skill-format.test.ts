import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import catalog from "@/agent-skills/catalog.json";
import { cleanSkillPath, contentVersion, docMeta, parseFrontmatter, parseSkillMarkdown } from "@/lib/skill-format";

describe("parseFrontmatter", () => {
  it("reads plain, quoted, block and folded scalars", () => {
    const { data, body } = parseFrontmatter(`---
name: my-skill
title: "Quoted: \\"yes\\""
single: 'it''s'
literal: |
  line one
  line two
folded: >
  joined
  words

  new paragraph
plain: starts here
  and continues
---
# Body`);
    expect(data).toMatchObject({
      name: "my-skill",
      title: 'Quoted: "yes"',
      single: "it's",
      literal: "line one\nline two",
      folded: "joined words\nnew paragraph",
      plain: "starts here and continues",
    });
    expect(body.trim()).toBe("# Body");
  });

  it("reads lists and a nested metadata map", () => {
    const { data } = parseFrontmatter(`---
tags: [a, "b", c]
items:
  - one
  - two
metadata:
  techteam-type: practice
  techteam-roles: tester, reviewer
---
`);
    expect(data.tags).toEqual(["a", "b", "c"]);
    expect(data.items).toEqual(["one", "two"]);
    expect(data.metadata).toEqual({ "techteam-type": "practice", "techteam-roles": "tester, reviewer" });
  });

  it("returns no data without a frontmatter fence", () => {
    expect(parseFrontmatter("# Just markdown").hasFrontmatter).toBe(false);
    expect(parseFrontmatter("---\nname: x\n(no closing fence)").hasFrontmatter).toBe(false);
  });
});

describe("parseSkillMarkdown", () => {
  const skill = (front: string) => `---\n${front}\n---\n# Body\n`;

  it("accepts a valid skill", () => {
    const result = parseSkillMarkdown(skill("name: web-testing\ndescription: How to test web apps.\nlicense: MIT"));
    expect(result).toMatchObject({ ok: true, skill: { name: "web-testing", description: "How to test web apps.", license: "MIT", body: "# Body" } });
  });

  it("enforces the Agent Skills name and description rules", () => {
    expect(parseSkillMarkdown("# no frontmatter")).toMatchObject({ ok: false });
    expect(parseSkillMarkdown(skill("description: x"))).toMatchObject({ ok: false, error: expect.stringContaining("name") });
    for (const bad of ["Web-Testing", "web_testing", "-web", "web-", "web--testing", "a".repeat(65)]) {
      expect(parseSkillMarkdown(skill(`name: ${bad}\ndescription: x`)).ok, bad).toBe(false);
    }
    expect(parseSkillMarkdown(skill("name: ok"))).toMatchObject({ ok: false, error: expect.stringContaining("description") });
    expect(parseSkillMarkdown(skill(`name: ok\ndescription: ${"x".repeat(1025)}`))).toMatchObject({ ok: false });
  });
});

describe("cleanSkillPath", () => {
  it("keeps safe relative paths", () => {
    expect(cleanSkillPath("SKILL.md")).toBe("SKILL.md");
    expect(cleanSkillPath("./guides/css/css-layout.md")).toBe("guides/css/css-layout.md");
  });

  it("rejects absolute, parent, backslash and odd paths", () => {
    for (const bad of ["/etc/passwd", "../secret.md", "guides/../../x.md", "a\\b.md", "C:/x.md", "a//b.md", "a/./b.md", "a/b$.md", "", 42]) {
      expect(cleanSkillPath(bad), String(bad)).toBeNull();
    }
  });
});

describe("docMeta", () => {
  it("uses the first heading and paragraph, skipping code and sub-headings", () => {
    expect(docMeta("guides/x.md", "# Fluid scaling\n\n## Overview\n\n```css\na{}\n```\n\nScale **components** with [container units](https://x).\nSecond line.\n\nLater.")).toEqual({
      title: "Fluid scaling",
      summary: "Scale components with container units. Second line.",
    });
  });

  it("uses frontmatter for SKILL.md and the file name as a last resort", () => {
    expect(docMeta("SKILL.md", "---\nname: my-skill\ndescription: Does things.\n---\n# Title")).toEqual({ title: "my-skill", summary: "Does things." });
    expect(docMeta("notes/checklist.txt", "just text")).toEqual({ title: "checklist", summary: "just text" });
  });
});

describe("built-in catalog", () => {
  // The sync script mirrors docMeta/contentVersion in plain JS; this keeps the two in step on the real files.
  it("matches what the app computes from the vendored files", () => {
    for (const skill of catalog.skills) {
      const files = skill.files.map((f) => ({ path: f.path, content: readFileSync(path.join("agent-skills", skill.slug, f.path), "utf8") }));
      const manifest = parseSkillMarkdown(files.find((f) => f.path === "SKILL.md")!.content);
      expect(manifest.ok, skill.slug).toBe(true);
      if (manifest.ok) expect({ name: manifest.skill.name, description: manifest.skill.description }).toEqual({ name: skill.name, description: skill.description });
      expect(contentVersion(files), skill.slug).toBe(skill.version);
      for (const file of files) {
        const entry = skill.files.find((f) => f.path === file.path)!;
        expect(docMeta(file.path, file.content), file.path).toEqual({ title: entry.title, summary: entry.summary });
      }
    }
  });
});
