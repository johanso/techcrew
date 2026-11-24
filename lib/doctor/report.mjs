// How `npm run doctor` prints its results: one line per check, a summary, a JSON form and the exit code.

const SYMBOL = { ok: "✓", info: "i", warn: "!", fail: "✗" };

/** @param {import("./checks.mjs").CheckResult[]} results */
export function summarize(results) {
  const counts = { ok: 0, info: 0, warn: 0, fail: 0 };
  for (const entry of results) counts[entry.status] += 1;
  return counts;
}

/** 1 only when something is a problem (✗); warnings never fail the run. @param {import("./checks.mjs").CheckResult[]} results */
export const exitCode = (results) => (results.some((entry) => entry.status === "fail") ? 1 : 0);

/** The text output: a line per check (the fix on the next line), then the summary. @param {import("./checks.mjs").CheckResult[]} results */
export function formatReport(results) {
  const lines = [];
  for (const entry of results) {
    lines.push(`${SYMBOL[entry.status]} ${entry.label}: ${entry.detail}`);
    if (entry.hint && (entry.status === "warn" || entry.status === "fail")) lines.push(`    Fix: ${entry.hint}`);
    else if (entry.hint) lines.push(`    ${entry.hint}`);
  }
  const counts = summarize(results);
  lines.push("");
  lines.push(
    counts.fail > 0
      ? `${counts.fail} problem${counts.fail === 1 ? "" : "s"}, ${counts.warn} warning${counts.warn === 1 ? "" : "s"}. Fix the ✗ lines first.`
      : counts.warn > 0
        ? `No problems, ${counts.warn} warning${counts.warn === 1 ? "" : "s"}. TechTeam can run.`
        : "All good. TechTeam can run.",
  );
  return lines.join("\n");
}

/** The `--json` output: `{ ok, summary, checks }`. @param {import("./checks.mjs").CheckResult[]} results */
export function toJson(results) {
  return JSON.stringify({ ok: exitCode(results) === 0, summary: summarize(results), checks: results }, null, 2);
}
