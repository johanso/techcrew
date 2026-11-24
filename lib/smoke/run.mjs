// What `npm run smoke` concludes from the run's rows: pure, so it is tested on fake rows.

/** The six agent stages, as in lib/agent-run-config.ts AGENT_STAGES (a test keeps the two equal). */
export const PIPELINE_STAGES = ["analysis", "development", "review", "security", "approval", "testing"];

/**
 * What to do after reading the run once.
 * @param {{ status: string, stage?: string | null, error?: string | null } | null} run
 * @param {{ elapsedMs: number, timeoutMs: number }} time
 * @returns {{ action: "wait" } | { action: "done" } | { action: "fail", reason: string }}
 */
export function decidePoll(run, { elapsedMs, timeoutMs }) {
  if (!run) return { action: "fail", reason: "The run row is gone." };
  switch (run.status) {
    case "awaiting_merge":
      return { action: "done" };
    case "failed":
      return { action: "fail", reason: `The run failed: ${run.error || "no reason recorded"}` };
    case "needs_info":
      return { action: "fail", reason: `The Analyst asked a question instead of working${run.error ? `: ${run.error}` : ""}` };
    case "cancelled":
      return { action: "fail", reason: "The run was cancelled." };
    case "completed":
      return { action: "fail", reason: "The run completed, but the smoke test expects it to wait for a manual merge (awaiting_merge)." };
    default:
      return elapsedMs > timeoutMs ? { action: "fail", reason: `Timed out after ${Math.round(timeoutMs / 60_000)} min with the run still ${run.status}${run.stage ? ` in ${run.stage}` : ""}.` } : { action: "wait" };
  }
}

/** One line when the run's status or stage changed since the last read, else null. @param {{ status: string, stage?: string | null } | null} before @param {{ status: string, stage?: string | null }} now */
export function describeChange(before, now) {
  if (before && before.status === now.status && before.stage === now.stage) return null;
  return `run ${now.status}${now.stage ? ` · ${now.stage}` : ""}`;
}

/**
 * Every pipeline stage left at least one log row and none failed or stopped.
 * @param {{ stage: string, tool: string, ok: boolean, summary?: string | null }[]} steps
 * @returns {{ ok: true } | { ok: false, problems: string[] }}
 */
export function checkPipeline(steps) {
  const problems = [];
  for (const stage of PIPELINE_STAGES) {
    const rows = steps.filter((step) => step.stage === stage);
    if (!rows.length) problems.push(`${stage}: no log rows, the stage never ran`);
    for (const row of rows.filter((entry) => !entry.ok || entry.tool === "stopped")) {
      problems.push(`${stage}: ${row.tool} failed${row.summary ? ` (${row.summary})` : ""}`);
    }
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

/**
 * One row per stage: how long it took, how many log rows, whether it passed.
 * @param {{ stage: string, ok: boolean, tool: string, createdAt: Date | string }[]} steps
 * @param {Date | string} startedAt when the run started: the first stage is measured from it
 */
export function stageRows(steps, startedAt) {
  const startMs = new Date(startedAt).getTime();
  return PIPELINE_STAGES.map((stage) => {
    const rows = steps.filter((step) => step.stage === stage);
    const times = rows.map((row) => new Date(row.createdAt).getTime());
    const first = times.length ? Math.min(...times) : null;
    const last = times.length ? Math.max(...times) : null;
    return {
      stage,
      steps: rows.length,
      status: !rows.length ? "missing" : rows.some((row) => !row.ok || row.tool === "stopped") ? "failed" : "ok",
      // From the run's start for the first stage, else the first row's time to the last row's.
      seconds: first === null || last === null ? 0 : Math.max(0, Math.round(((stage === PIPELINE_STAGES[0] ? last - startMs : last - first)) / 1000)),
    };
  });
}

/**
 * The compact table printed at the end.
 * @param {{ stage: string, status: string, seconds: number, steps: number }[]} rows
 * @param {{ totalSeconds: number, outcome: string, pullRequest?: number | null, branch?: string | null }} footer
 */
export function formatSummary(rows, { totalSeconds, outcome, pullRequest, branch }) {
  const pad = (text, width) => String(text).padEnd(width);
  const lines = [`${pad("stage", 13)}${pad("status", 9)}${pad("seconds", 9)}steps`];
  for (const row of rows) lines.push(`${pad(row.stage, 13)}${pad(row.status, 9)}${pad(row.seconds, 9)}${row.steps}`);
  lines.push(`total ${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s · ${outcome}${pullRequest ? ` · PR #${pullRequest}` : ""}${branch ? ` · ${branch}` : ""}`);
  return lines.join("\n");
}

/**
 * The last log rows as they are stored (targets and short outcomes, never content), for a failure report.
 * @param {{ stage: string, round: number, tool: string, target?: string | null, ok: boolean, summary?: string | null }[]} steps
 */
export function lastLogLines(steps, count = 12) {
  return steps.slice(-count).map((step) => `${step.ok ? "ok  " : "FAIL"} ${step.stage}/${step.round} ${step.tool}${step.target ? ` ${step.target}` : ""}${step.summary ? ` — ${step.summary}` : ""}`);
}

/** The last lines of a log. @param {string} text */
export function tailLines(text, count = 40) {
  return text.split(/\r?\n/).filter(Boolean).slice(-count);
}
