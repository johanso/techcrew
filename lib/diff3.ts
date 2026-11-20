/**
 * A three-way text merge (diff3) for merge_default_branch (lib/branch-merge.ts): the merge base, your branch and the
 * default branch in, the merged text out, with conflict markers where both sides changed the same lines. Pure and
 * tested; no git or sandbox needed. Lines are compared exactly (line endings included), like git.
 *
 * Matching is Myers' shortest edit script on lines (common prefix and suffix trimmed first), and the merge follows
 * the classic diff3 walk (Khanna, Kuber and Pierce, "A Formal Investigation of Diff3"): stable runs where all three
 * agree are kept, each unstable run between them takes the side that changed it, or is a conflict when both did. A
 * conflict shows the merge base too (git's "zdiff3" style), with lines both sides share at its edges moved out of it.
 */

/** The text split after each "\n"; the last line may lack one. "" has no lines. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/(?<=\n)/);
  return lines;
}

/** Above this many edits between two texts, matching gives up and the changed middle is one conflict instead. */
const MAX_EDITS = 2000;

/**
 * Index pairs [i, j] with a[i] === b[j], increasing in both: a longest common subsequence of lines (Myers). Past
 * MAX_EDITS it keeps only the common prefix and suffix, which is still a valid (if coarse) matching.
 */
export function matchLines(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  pairs.push(...myers(a.slice(start, endA), b.slice(start, endB)).map(([i, j]): [number, number] => [i + start, j + start]));
  for (let i = 0; i < a.length - endA; i++) pairs.push([endA + i, endB + i]);
  return pairs;
}

function myers(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  // Lines as numbers: cheaper to compare in the inner loop.
  const ids = new Map<string, number>();
  const id = (line: string) => {
    let value = ids.get(line);
    if (value === undefined) ids.set(line, (value = ids.size));
    return value;
  };
  const A = Int32Array.from(a, id);
  const B = Int32Array.from(b, id);

  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d]: the furthest x on each diagonal k (|k| ≤ d + 1) before step d, for the walk back.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [];

  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const before = trace[d]!;
    const at = (k: number) => before[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

export type MergeLabels = { ours: string; base: string; theirs: string };

export type TextMerge = {
  text: string;
  /** Conflicting sections left in `text`; 0 means the merge is clean. */
  conflicts: number;
};

const sameLines = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, i) => line === b[i]);

/** A conflict side's lines, ending in a newline so the next marker starts its own line. */
function block(lines: readonly string[]) {
  const text = lines.join("");
  return text && !text.endsWith("\n") ? `${text}\n` : text;
}

/**
 * Merges `ours` and `theirs`, both changed from `base`. Where they changed the same lines differently, the text gets
 * a conflict: `<<<<<<< ours`, our lines, `||||||| base`, the base's lines, `=======`, their lines, `>>>>>>> theirs`.
 */
export function mergeText(base: string, ours: string, theirs: string, labels: MergeLabels): TextMerge {
  const O = splitLines(base);
  const A = splitLines(ours);
  const B = splitLines(theirs);
  const toA = new Map(matchLines(O, A));
  const toB = new Map(matchLines(O, B));

  const out: string[] = [];
  let conflicts = 0;
  const unstable = (o: readonly string[], a: readonly string[], b: readonly string[]) => {
    if (sameLines(o, a)) out.push(...b);
    else if (sameLines(o, b) || sameLines(a, b)) out.push(...a);
    else {
      // Lines both sides start or end with aren't part of the disagreement.
      let head = 0;
      while (head < a.length && head < b.length && a[head] === b[head]) head++;
      let tail = 0;
      while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
      out.push(...a.slice(0, head));
      conflicts++;
      out.push(
        `<<<<<<< ${labels.ours}\n`,
        block(a.slice(head, a.length - tail)),
        `||||||| ${labels.base}\n`,
        block(o),
        "=======\n",
        block(b.slice(head, b.length - tail)),
        `>>>>>>> ${labels.theirs}\n`
      );
      out.push(...a.slice(a.length - tail));
    }
  };

  let lo = 0;
  let la = 0;
  let lb = 0;
  while (lo < O.length || la < A.length || lb < B.length) {
    // A stable run: base, ours and theirs move together.
    let i = 0;
    while (lo + i < O.length && toA.get(lo + i) === la + i && toB.get(lo + i) === lb + i) i++;
    if (i > 0) {
      out.push(...O.slice(lo, lo + i));
      lo += i;
      la += i;
      lb += i;
      continue;
    }
    // Up to the next base line both sides kept: an unstable run.
    let j = lo;
    while (j < O.length && !(toA.has(j) && toB.has(j))) j++;
    if (j === O.length) {
      unstable(O.slice(lo), A.slice(la), B.slice(lb));
      break;
    }
    const ka = toA.get(j)!;
    const kb = toB.get(j)!;
    unstable(O.slice(lo, j), A.slice(la, ka), B.slice(lb, kb));
    lo = j;
    la = ka;
    lb = kb;
  }
  return { text: out.join(""), conflicts };
}

// The markers a merge writes; "=======" alone is also a Markdown heading underline, so it counts only beside the others.
const MARKER = /^(<{7}|>{7}|\|{7})(?: |\r?$)/;
const SEPARATOR = /^={7}\r?$/;

/**
 * 1-based numbers of the lines in `text` that look like conflict markers and aren't in any of `allowed` (the two
 * sides' own versions: a file may legitimately contain such a line, e.g. a test about conflicts).
 */
export function conflictMarkerLines(text: string, allowed: readonly string[] = []): number[] {
  const known = new Set(allowed.flatMap((side) => splitLines(side).map((line) => line.replace(/\r?\n$/, ""))));
  const lines = splitLines(text).map((line) => line.replace(/\r?\n$/, ""));
  const strong = lines.some((line) => MARKER.test(line) && !known.has(line));
  return lines.flatMap((line, i) => ((MARKER.test(line) || (strong && SEPARATOR.test(line))) && !known.has(line) ? [i + 1] : []));
}
