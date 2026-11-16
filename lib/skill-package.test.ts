import { describe, expect, it } from "vitest";

import { UPLOAD_FILES_MAX, UPLOAD_MAX_BYTES } from "@/lib/agent-skills-config";
import { readSkillPackage } from "@/lib/skill-package";
import { ZipError, listZip, readZipEntry } from "@/lib/skill-zip";
import { makeZip } from "@/test/zip";

const SKILL = "---\nname: web-testing\ndescription: How to test web apps.\n---\n# Web testing\n\nWrite tests first.\n";

describe("readZipEntry", () => {
  it("reads stored and deflated files", () => {
    const zip = makeZip([
      { path: "a.md", content: "stored", store: true },
      { path: "b.md", content: "deflated ".repeat(50) },
    ]);
    const entries = listZip(zip);
    expect(entries.map((e) => [e.path, e.kind])).toEqual([
      ["a.md", "file"],
      ["b.md", "file"],
    ]);
    expect(readZipEntry(zip, entries[0]!).toString()).toBe("stored");
    expect(readZipEntry(zip, entries[1]!).toString()).toBe("deflated ".repeat(50));
  });

  it("stops at the declared size (zip bomb) and reports links", () => {
    const zip = makeZip([
      { path: "bomb.md", content: "x".repeat(100_000), declaredSize: 10 },
      { path: "link.md", content: "/etc/passwd", mode: 0o120777 },
    ]);
    const [bomb, link] = listZip(zip);
    expect(() => readZipEntry(zip, bomb!)).toThrow(ZipError);
    expect(link!.kind).toBe("symlink");
  });

  it("rejects what isn't a zip", () => {
    expect(() => listZip(Buffer.from("not a zip at all, definitely not"))).toThrow(ZipError);
  });
});

describe("readSkillPackage", () => {
  it("takes a single markdown file as SKILL.md", () => {
    const result = readSkillPackage("my-skill.md", Buffer.from(SKILL));
    expect(result).toMatchObject({ ok: true, pkg: { manifest: { name: "web-testing" }, files: [{ path: "SKILL.md", title: "web-testing" }] } });
  });

  it("finds SKILL.md at the root or one folder deep and keeps only text files", () => {
    for (const prefix of ["", "web-testing/"]) {
      const zip = makeZip([
        { path: `${prefix}SKILL.md`, content: SKILL },
        { path: `${prefix}references/checklist.md`, content: "# Checklist\n\nCheck things." },
        { path: `${prefix}notes.txt`, content: "plain notes" },
        { path: `${prefix}scripts/run.sh`, content: "rm -rf /" },
        { path: `${prefix}.hidden.md`, content: "hidden" },
        { path: "__MACOSX/._SKILL.md", content: "junk" },
      ]);
      const result = readSkillPackage("skill.zip", zip);
      expect(result.ok, prefix).toBe(true);
      if (!result.ok) continue;
      expect(result.pkg.files.map((f) => f.path)).toEqual(["SKILL.md", "notes.txt", "references/checklist.md"]);
      expect(result.pkg.ignored).toEqual(
        expect.arrayContaining([expect.stringContaining("run.sh (not a .md"), expect.stringContaining(".hidden.md (hidden"), expect.stringContaining("(system file)")])
      );
      expect(result.pkg.version).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it("rejects unsafe archives", () => {
    const cases: [string, Buffer][] = [
      ["parent path", makeZip([{ path: "SKILL.md", content: SKILL }, { path: "../evil.md", content: "x" }])],
      ["absolute path", makeZip([{ path: "SKILL.md", content: SKILL }, { path: "/etc/evil.md", content: "x" }])],
      ["symlink", makeZip([{ path: "SKILL.md", content: SKILL }, { path: "ref.md", content: "/etc/passwd", mode: 0o120777 }])],
      ["no SKILL.md", makeZip([{ path: "README.md", content: "# hi" }])],
      ["two skills", makeZip([{ path: "a/SKILL.md", content: SKILL }, { path: "b/SKILL.md", content: SKILL }])],
      ["too deep", makeZip([{ path: "a/b/SKILL.md", content: SKILL }])],
      ["bad frontmatter", makeZip([{ path: "SKILL.md", content: "---\nname: Bad Name\ndescription: x\n---\n" }])],
    ];
    for (const [label, zip] of cases) expect(readSkillPackage("skill.zip", zip).ok, label).toBe(false);
  });

  it("enforces the limits", () => {
    expect(readSkillPackage("big.zip", Buffer.alloc(UPLOAD_MAX_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining("larger than") });
    const many = makeZip([{ path: "SKILL.md", content: SKILL }, ...Array.from({ length: UPLOAD_FILES_MAX }, (_, i) => ({ path: `refs/${i}.md`, content: "x" }))]);
    expect(readSkillPackage("many.zip", many)).toMatchObject({ ok: false, error: expect.stringContaining("limit") });
    const huge = makeZip([{ path: "SKILL.md", content: SKILL }, { path: "big.md", content: "a".repeat(3 * 1024 * 1024) }]);
    expect(readSkillPackage("huge.zip", huge)).toMatchObject({ ok: false, error: expect.stringContaining("add up to") });
    expect(readSkillPackage("skill.pdf", Buffer.from("x"))).toMatchObject({ ok: false });
  });
});
