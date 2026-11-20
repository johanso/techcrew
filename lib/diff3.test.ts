import { describe, expect, it } from "vitest";

import { conflictMarkerLines, matchLines, mergeText, splitLines } from "@/lib/diff3";

const labels = { ours: "agent/acm-1 (your branch)", base: "merge base", theirs: "main (default branch)" };
const lines = (...items: string[]) => items.map((item) => `${item}\n`).join("");

/** Classic LCS length by dynamic programming, to check matchLines against. */
function lcsLength(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  return dp[0]![0]!;
}

// A small deterministic generator, so the property tests are repeatable.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe("splitLines", () => {
  it("keeps line endings and a last line without one", () => {
    expect(splitLines("a\nb\r\nc")).toEqual(["a\n", "b\r\n", "c"]);
    expect(splitLines("a\n")).toEqual(["a\n"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("matchLines", () => {
  it("finds a longest common subsequence, increasing on both sides", () => {
    const next = random(7);
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: Math.floor(next() * 12) }, () => "abcd"[Math.floor(next() * 4)]!);
      const b = Array.from({ length: Math.floor(next() * 12) }, () => "abcd"[Math.floor(next() * 4)]!);
      const pairs = matchLines(a, b);
      expect(pairs.length, `${a.join("")} / ${b.join("")}`).toBe(lcsLength(a, b));
      pairs.forEach(([i, j], k) => {
        expect(a[i]).toBe(b[j]);
        if (k > 0) {
          expect(i).toBeGreaterThan(pairs[k - 1]![0]);
          expect(j).toBeGreaterThan(pairs[k - 1]![1]);
        }
      });
    }
  });

  it("handles empty sides", () => {
    expect(matchLines([], ["a"])).toEqual([]);
    expect(matchLines(["a"], [])).toEqual([]);
  });

  it("keeps the common prefix and suffix of texts too different to match in full", () => {
    const a = ["start", ...Array.from({ length: 3000 }, (_, i) => `a${i}`), "end"];
    const b = ["start", ...Array.from({ length: 3000 }, (_, i) => `b${i}`), "end"];
    expect(matchLines(a, b)).toEqual([
      [0, 0],
      [3001, 3001],
    ]);
  });
});

describe("mergeText", () => {
  const base = lines("one", "two", "three", "four", "five");

  it("merges changes to different lines", () => {
    const ours = lines("ONE", "two", "three", "four", "five");
    const theirs = lines("one", "two", "three", "four", "FIVE", "six");
    expect(mergeText(base, ours, theirs, labels)).toEqual({ text: lines("ONE", "two", "three", "four", "FIVE", "six"), conflicts: 0 });
  });

  it("takes a change both sides made the same way once", () => {
    const both = lines("one", "TWO", "three", "four", "five");
    expect(mergeText(base, both, both, labels)).toEqual({ text: both, conflicts: 0 });
  });

  it("takes one side's deletion", () => {
    expect(mergeText(base, lines("one", "two", "four", "five"), base, labels)).toEqual({ text: lines("one", "two", "four", "five"), conflicts: 0 });
  });

  it("marks lines both sides changed differently, with the merge base", () => {
    const merged = mergeText(base, lines("one", "two", "ours", "four", "five"), lines("one", "two", "theirs", "four", "five"), labels);
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toBe(
      lines("one", "two", "<<<<<<< agent/acm-1 (your branch)", "ours", "||||||| merge base", "three", "=======", "theirs", ">>>>>>> main (default branch)", "four", "five")
    );
  });

  it("moves lines both sides share at a conflict's edges out of it", () => {
    const merged = mergeText(lines("a", "b"), lines("a", "x", "same", "b"), lines("a", "y", "same", "b"), labels);
    expect(merged.text).toBe(lines("a", "<<<<<<< agent/acm-1 (your branch)", "x", "||||||| merge base", "=======", "y", ">>>>>>> main (default branch)", "same", "b"));
  });

  it("merges a file both sides added as one conflict where they differ", () => {
    const merged = mergeText("", lines("import a", "ours"), lines("import a", "theirs"), labels);
    expect(merged.conflicts).toBe(1);
    expect(merged.text.startsWith("import a\n<<<<<<< ")).toBe(true);
  });

  it("puts a marker on its own line after a last line without a newline", () => {
    const merged = mergeText("x", "ours", "theirs", labels);
    expect(merged.text).toBe("<<<<<<< agent/acm-1 (your branch)\nours\n||||||| merge base\nx\n=======\ntheirs\n>>>>>>> main (default branch)\n");
  });

  it("keeps Windows line endings untouched outside conflicts", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    expect(mergeText(crlf, "A\r\nb\r\nc\r\n", "a\r\nb\r\nC\r\n", labels)).toEqual({ text: "A\r\nb\r\nC\r\n", conflicts: 0 });
  });

  it("merges edits in separate halves of a file cleanly (random cases)", () => {
    const next = random(42);
    for (let round = 0; round < 100; round++) {
      const original = Array.from({ length: 40 }, (_, i) => `line ${i}`);
      const edit = (from: number, to: number, tag: string) =>
        original.flatMap((line, i) => {
          if (i < from || i >= to) return [line];
          const roll = next();
          return roll < 0.2 ? [] : roll < 0.4 ? [`${line} ${tag}`] : roll < 0.5 ? [line, `${tag} added ${i}`] : [line];
        });
      // A separator line neither side touches keeps the halves apart.
      const ours = edit(0, 19, "ours");
      const theirs = edit(21, 40, "theirs");
      const expected = [...ours.slice(0, ours.indexOf("line 20")), ...theirs.slice(theirs.indexOf("line 20"))];
      const merged = mergeText(lines(...original), lines(...ours), lines(...theirs), labels);
      expect(merged.conflicts).toBe(0);
      expect(merged.text).toBe(lines(...expected));
    }
  });
});

describe("conflictMarkerLines", () => {
  it("finds leftover markers", () => {
    expect(conflictMarkerLines(lines("a", "<<<<<<< agent/x (your branch)", "b", "=======", "c", ">>>>>>> main (default branch)"))).toEqual([2, 4, 6]);
    expect(conflictMarkerLines(lines("a", "||||||| merge base"))).toEqual([2]);
    expect(conflictMarkerLines("a\r\n<<<<<<<\r\n")).toEqual([2]);
  });

  it("ignores a Markdown underline alone and markers already in a side", () => {
    expect(conflictMarkerLines(lines("Title", "======="))).toEqual([]);
    const fixture = lines("const sample = `", "<<<<<<< HEAD", "`;");
    expect(conflictMarkerLines(fixture, [fixture])).toEqual([]);
    expect(conflictMarkerLines(lines("<<<<<<< HEAD", "x"), [lines("<<<<<<< other")])).toEqual([1]);
  });

  it("doesn't flag longer runs of the same characters", () => {
    expect(conflictMarkerLines(lines("<<<<<<<<", "========", ">>>>>>>>"))).toEqual([]);
  });
});
