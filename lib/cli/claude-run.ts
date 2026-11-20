import "server-only";

import { timingSafeEqual } from "node:crypto";
import path from "node:path";

import { deriveSecret } from "@/lib/crypto";
import type { AgentStage } from "@/lib/agent-run-config";
import { MCP_TOKEN_ENV, claudeChunkArgs, claudeStreamReader, classifyClaudeChunk, foreignTools, type ClaudeChunkOutcome, type ClaudeStreamSummary } from "@/lib/cli/claude-config";
import { claudeEnv, detectClaude, runWorkdir } from "@/lib/cli/index";

// Not imported: Turbopack would trace these calls' dynamic paths as references to the whole project (see lib/cli/index.ts).
const { spawn } = process.getBuiltinModule("node:child_process") as typeof import("node:child_process");
const { writeFile } = process.getBuiltinModule("node:fs/promises") as typeof import("node:fs/promises");

/**
 * One chunk of a stage on Claude Code (docs/cli-agents-plan.md §3.4): `claude -p` for up to `maxTurns` turns, the
 * session started or resumed by id, so the stage spans several short Inngest steps and survives a restart between
 * them. The agent's tools are TechTeam's MCP endpoint for this run and stage (app/api/mcp/runs/[runId]); the finish
 * tool stores the stage's result there, and the stage reads it after the chunk.
 */

/** The bearer the CLI sends to the run's MCP endpoint: derived per run, stage and round, so nothing is stored. */
export function mcpRunCredential(runId: number, stage: AgentStage, round: number) {
  return deriveSecret(`mcp-run:${runId}:${stage}:${round}`);
}

/** Checks a presented MCP bearer in constant time. */
export function verifyMcpRunCredential(runId: number, stage: AgentStage, round: number, presented: string) {
  const expected = Buffer.from(mcpRunCredential(runId, stage, round));
  const given = Buffer.from(presented);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The MCP endpoint of a run's stage on this computer (the app's own local address). */
export function mcpRunUrl(runId: number, stage: AgentStage, round: number, turn: number) {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  const query = new URLSearchParams({ stage, round: String(round), turn: String(turn) });
  return `${origin}/api/mcp/runs/${runId}?${query}`;
}

// A chunk is a handful of turns; this is a backstop for a CLI that hangs, not a budget.
const CHUNK_TIMEOUT_MS = 20 * 60_000;
// How often a running chunk checks whether the run was stopped, to end the CLI instead of letting it finish.
const STOP_POLL_MS = 10_000;
const STDERR_KEEP = 20_000;

export type ClaudeChunk = {
  runId: number;
  stage: AgentStage;
  round: number;
  /** The stage's turn this chunk starts at (from 1), for the agent log. */
  turn: number;
  model: string;
  sessionId: string;
  resume: boolean;
  prompt: string;
  systemPrompt: string;
  maxTurns: number;
  effort: string | null;
  /** Polled while the CLI works: true ends it (the run was stopped). */
  shouldStop: () => Promise<boolean>;
};

export type ClaudeChunkRun = { summary: ClaudeStreamSummary; outcome: ClaudeChunkOutcome; stopped: boolean };

/** Runs one chunk and reads what happened. Never throws for the CLI's own failures: they come back as the outcome. */
export async function runClaudeChunk(chunk: ClaudeChunk): Promise<ClaudeChunkRun> {
  const detection = await detectClaude();
  const reader = claudeStreamReader();
  if (!detection.binary || detection.problem) {
    return { summary: reader.summary, outcome: { kind: "error", message: detection.problem ?? "Claude Code isn't installed on this computer." }, stopped: false };
  }
  const dir = await runWorkdir(chunk.runId);
  // The system prompt goes in a file, not argv (Windows caps a command line at ~32K characters). The session records
  // it on its first request; a resumed chunk sends the same text.
  const systemPromptFile = path.join(dir, `system-${chunk.stage}-${chunk.round}.md`);
  await writeFile(systemPromptFile, chunk.systemPrompt, { mode: 0o600 });

  const args = claudeChunkArgs({
    model: chunk.model,
    maxTurns: chunk.maxTurns,
    sessionId: chunk.sessionId,
    resume: chunk.resume,
    mcpUrl: mcpRunUrl(chunk.runId, chunk.stage, chunk.round, chunk.turn),
    systemPromptFile,
    effort: chunk.effort,
  });
  const env = claudeEnv({ [MCP_TOKEN_ENV]: mcpRunCredential(chunk.runId, chunk.stage, chunk.round) });

  return new Promise((resolve) => {
    const child = spawn(detection.binary!, args, { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let pending = "";
    let stderr = "";
    let timedOut = false;
    let stopped = false;
    let foreign: string[] = [];
    child.stdout.on("data", (data: Buffer) => {
      pending += data.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        reader.line(line);
        // The session's first event lists its tools: anything besides TechTeam's means the isolation broke (a CLI
        // update, a settings change). End it before the model's first turn can use them.
        if (reader.summary.init && !foreign.length) {
          const extra = foreignTools(reader.summary.init);
          if (extra.length) {
            foreign = extra;
            end();
          }
        }
      }
    });
    child.stderr.on("data", (data: Buffer) => (stderr = (stderr + data.toString("utf8")).slice(-STDERR_KEEP)));

    const end = () => {
      child.kill();
      // A CLI that ignores the polite signal gets the hard one.
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      end();
    }, CHUNK_TIMEOUT_MS);
    const poll = setInterval(() => {
      void chunk
        .shouldStop()
        .then((stop) => {
          if (stop && !stopped) {
            stopped = true;
            end();
          }
        })
        .catch(() => undefined);
    }, STOP_POLL_MS);

    const finish = (exitCode: number | null) => {
      clearTimeout(deadline);
      clearInterval(poll);
      if (pending) reader.line(pending);
      resolve({ summary: reader.summary, outcome: classifyClaudeChunk(reader.summary, { exitCode, stderr, timedOut, foreign }), stopped });
    };
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", finish);
    child.stdin.end(chunk.prompt);
  });
}
