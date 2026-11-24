import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readLines } from "./lines.mjs";
import { createArchive, extractArchive, inspectExtracted, listArchive } from "./tar.mjs";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "techteam-archive-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tables = new Set(["users"]);

describe("archive on disk (system tar)", () => {
  it("packs, lists, extracts and inspects a staging folder", async () => {
    const staging = path.join(dir, "staging");
    await mkdir(path.join(staging, "tables"), { recursive: true });
    await mkdir(path.join(staging, "files", "a"), { recursive: true });
    await writeFile(path.join(staging, "manifest.json"), "{}");
    await writeFile(path.join(staging, "tables", "users.jsonl"), '{"id":1}\n');
    await writeFile(path.join(staging, "files", "a", "b.png"), "png");
    const archive = path.join(dir, "out.tar.gz");
    await createArchive(staging, archive);

    const names = (await listArchive(archive)).map((entry) => entry.name).sort();
    expect(names).toEqual(expect.arrayContaining(["manifest.json", "tables/users.jsonl", "files/a/b.png"]));

    const target = path.join(dir, "extracted");
    await mkdir(target);
    await extractArchive(archive, target);
    const found = await inspectExtracted(target, tables);
    expect(found.problems).toEqual([]);
    expect(found.hasManifest).toBe(true);
    expect(found.tables).toEqual(["users"]);
    expect(found.files.map((file) => file.key)).toEqual(["a/b.png"]);
  });

  it("flags an unknown table, a stray file and a symlink in an extracted folder", async () => {
    const root = path.join(dir, "root");
    await mkdir(path.join(root, "tables"), { recursive: true });
    await writeFile(path.join(root, "manifest.json"), "{}");
    await writeFile(path.join(root, "tables", "secrets.jsonl"), "");
    await writeFile(path.join(root, "notes.txt"), "");
    // Creating a symlink needs a privilege on some Windows setups: the check then only covers the other two.
    const linked = await symlink(path.join(dir, "elsewhere"), path.join(root, "files")).then(
      () => true,
      () => false,
    );
    const found = await inspectExtracted(root, tables);
    expect(found.problems.some((problem) => /not a table/.test(problem))).toBe(true);
    expect(found.problems.some((problem) => /notes\.txt/.test(problem))).toBe(true);
    if (linked) expect(found.problems.some((problem) => /link or special/.test(problem))).toBe(true);
  });
});

describe("readLines", () => {
  it("splits lines across chunks and keeps a last line without a newline", async () => {
    const file = path.join(dir, "x.jsonl");
    await writeFile(file, `${"a".repeat(100_000)}\n{"b":2}\nlast`);
    const lines: string[] = [];
    for await (const line of readLines(file)) lines.push(line.length > 20 ? `${line.length}` : line);
    expect(lines).toEqual(["100000", '{"b":2}', "last"]);
  });

  it("refuses a line over the limit", async () => {
    const file = path.join(dir, "y.jsonl");
    await writeFile(file, "x".repeat(1000));
    await expect(async () => {
      for await (const line of readLines(file, 100)) void line;
    }).rejects.toThrow(/longer than/);
  });
});
