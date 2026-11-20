# Agents on your plan (local CLIs)

When TechTeam runs on your own computer, agents on Claude models can work on your **Claude plan** (Pro or Max) through
**Claude Code** installed there, instead of an Anthropic API key. Plan stages cost no API money: TechTeam records their
turns and tokens, plus the API-equivalent cost Claude Code reports, as a reference only.

The design and its reasons are in [cli-agents-plan.md](cli-agents-plan.md). Codex (OpenAI models on a ChatGPT plan)
comes later on the same rules.

## The rules in one place

- **Only locally.** CLI agents exist when the app's own URL (`NEXT_PUBLIC_APP_URL`) is a local address and no hosting
  platform marker is set (`VERCEL`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`, …): `cliAgentsAllowed` in
  `lib/cli-agents-config.ts`. A deploy never shows, detects or spawns a CLI, and the MCP endpoint answers 404 there.
  `AGENTS_LOCAL_CLI=false` turns the feature off on one computer; there is no variable to turn it on.
- **The model is the agent's; the route is the computer's.** Agents keep their company and model (AI Team →
  Configure). Settings → AI → *Plans on this computer* decides whether this computer sends Claude models through the
  plan. Switching it, the plan running out or opening TechTeam on the other computer never edits an agent (the only
  exception is the existing auto failover, if you choose it as the plan-limit action).
- **Per user and per computer.** The database is shared by your computers, so the switch, the confirmed account and
  the plan-limit choice live in `cli_settings`, keyed by a machine id that TechTeam keeps in its CLI home. What this
  computer learned (a model the plan refused, the window running out) stays in `<CLI home>/state.json`.
- **Your own login, separate from your normal Claude Code.** TechTeam runs Claude Code with
  `CLAUDE_CONFIG_DIR=<CLI home>/claude` (`~/.techteam/cli/claude`, or `TECHTEAM_CLI_HOME`). You sign in there once with
  your **personal** account; your usual login (for example a work organization) is never read or changed. Checked on
  2.1.326: an empty config home reports `loggedIn: false` while the normal one is signed in.
- **Confirmed account.** Settings shows `email · organization · plan` and asks you to confirm it. Every stage checks
  the CLI is still signed in to that account (same email, same organization) and refuses to run otherwise.
- **Spend vs usage.** API stages keep cost tracking and budgets as before. Plan stages add tokens and an
  `equivalent_micros` reference to their activity row (`billing = 'plan'`), never to `cost_micros`; budgets don't apply
  to them (the brake is max turns). The AI Team tile reads "API spending this month".

## Route resolution

`resolveRoute` (pure, tested) runs when each stage starts, on the computer that runs it, and the route is pinned in the
stage's `LoopState` like the model:

| Model | Plan route when… | Otherwise |
| --- | --- | --- |
| Claude (Anthropic) | Claude Code is installed here, switched on, signed in with a plan login to the confirmed account, the plan includes the model (Pro has no Opus) and this computer hasn't seen the plan's window run out | the Anthropic API key |
| OpenAI | (Codex, later) | the OpenAI key |
| OpenRouter | never | the OpenRouter key |

With neither a plan route nor a key, **Run** (and auto pickup) refuses before anything starts, naming the agent and the
fix (`pipelineModelProblem`). When the plan is on but can't carry a stage, the agent log adds a **Route** line saying
why the stage took the API key.

## How a stage runs

```
runStageTurn ── route? ──▶ api: one model turn per Inngest step (as before)
     │
     └──▶ claude-plan: one chunk per step (up to 10 turns)
            claude -p --resume <session> --max-turns k  (prompt on stdin, system prompt from a file)
              │  tools only through MCP
              ▼
            POST /api/mcp/runs/<runId>?stage&round&turn   (Bearer: HMAC of run + stage + round)
              ├─ tools/list → toolsFor(stage, permissions, …) + the finish tool
              ├─ tools/call → callTool (same code as API turns) → agent log row right away
              └─ finish tool → agent_runs.cli_results["<stage>:<round>"]
            after the chunk: result stored? → stage done; else next chunk resumes the session
```

- **Chunks** (`CLI_CHUNK_TURNS = 10`) keep Inngest steps short and retry-safe: the first chunk creates the session
  (`--session-id`), later ones `--resume` it. A retried first chunk finds its session file and resumes it. The turn
  limit works as before: the chunk that reaches it says how many turns are left and how to finish unfinished work, and
  `settleOutOfTurns` handles a stage that ends without its finish tool.
- **Isolation flags** (`claudeChunkArgs`, checked against 2.1.326): `--tools ""` (no built-in tools at all),
  `--strict-mcp-config --mcp-config <inline JSON>` (only TechTeam's server), `--allowedTools mcp__techteam__*`,
  `--setting-sources ""` (no settings files), `--disable-slash-commands` (no skills or commands),
  `--permission-prompts none`, `--output-format stream-json --verbose`. Not `--bare`: it never reads OAuth or the
  keychain, so it can't use a plan login. The MCP config names `${TECHTEAM_MCP_TOKEN}`; the bearer travels only in the
  child's environment, never on the command line.
- **Environment**: an allowlist (`childEnv`: `PATH`, `HOME`, `TMPDIR`, and on Windows `SystemRoot`, `USERPROFILE`,
  `APPDATA`, `LOCALAPPDATA`, `TEMP`/`TMP`, `PATHEXT`), plus `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER=1` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Never API keys, the database URL or tokens.
- **Working folder**: an empty `os.tmpdir()/techteam/run-<id>/` (outside the project, which Turbopack watches), removed
  when the run finishes.
- **Stop**: a running chunk checks the run every 10 s and ends the CLI when it was stopped.
- **Images**: references and the Tester's screenshots come back as MCP image content (loaded from S3 per call, never
  stored), so Claude models keep their vision.
- **Results bigger than 50 K characters** would make Claude Code save them to a file the agent can't open (it has no
  file tools): every tool declares `_meta["anthropic/maxResultSizeChars"] = 100000`, above the tools' own clipping.

The MCP server (`lib/mcp-protocol.ts`) is a minimal stateless Streamable HTTP implementation: `initialize`, `ping`,
`tools/list`, `tools/call`, JSON responses, 202 for notifications, no sessions or event stream. Verified against the
real CLI without a login (no spend): it connects, lists exactly `mcp__techteam__*`, and reports no other tools.

## When the plan runs out

Claude Code reports a rejected rate limit (`rate_limit_event` with `resetsAt`) or a usage-limit message
(`classifyClaudeChunk`). The computer remembers the reset time (later stages take the key or wait), then **When my plan
runs out** (Settings, per computer) decides (`planLimitAction`, pure and tested):

| Choice | What happens |
| --- | --- |
| **Wait for the reset** (default without an Anthropic key) | The run pauses: `agent_runs.waiting`, the card says "Waiting for your Claude plan · resets 3:40 PM", the bell notifies once, Inngest sleeps until a minute after the reset (every 30 min when no time is given) and the stage **resumes the same CLI session**. Stop still works while it waits. A reset more than a day away (a weekly limit) doesn't hold the card: the key, else a stop. |
| **Continue on the API key** (default with a key) | The stage starts over on the same model through the key (a CLI conversation can't move to the API); the agent log notes the switch. |
| **Switch company** | The existing auto failover: agents on Claude models move to another company with a key (this edits agents). Needs auto failover on. |

When none is possible, the run stops with `failure = { kind: "plan_limit", cli, resetsAt }` and a notification. A model
the plan doesn't include ("Claude Opus is not available with the Claude Pro plan") is remembered on this computer and
the stage restarts on the key, or stops when there is none.

## Two computers, one database

Each computer runs its own app and Inngest Dev Server (`npm run dev`); a run executes on the computer whose Inngest
received it, and route resolution happens there. The same agent may take the plan on the Mac and the key on the
Windows PC: that's intended.

- **One run in flight per card**: a unique partial index (`agent_runs_one_active_per_task`, queued or running) makes
  `createRun` return nothing on the second start, so two computers can't run the same card.
- **Auto pickup** runs on every computer whose Inngest is up. Keep it on one: set `AGENTS_AUTO_PICKUP=false` in the
  other computer's `.env`.

## Setting it up

1. Install Claude Code's native build (Settings shows the command for your OS when it's missing).
2. Settings → AI → *Plans on this computer* → **Sign in**: Claude Code opens your browser; sign in with your personal
   account, then **Check again**. (Or run it yourself:
   `CLAUDE_CONFIG_DIR=~/.techteam/cli/claude claude auth login`; on Windows PowerShell
   `$env:CLAUDE_CONFIG_DIR="$HOME\.techteam\cli\claude"; claude auth login`.)
3. Check the account line (email · organization · plan) and **Confirm this account**.
4. Switch on **Use my Claude plan for Claude models**, and pick what happens when the plan runs out.
5. Agents on Claude models show **Your Claude plan** on the AI Team page.

On Windows, an npm-installed `claude.cmd` is refused (it would need a shell to run with the agent's arguments): install
the native build.

## To watch in the first live runs

- **Step length**: a chunk holds one Inngest step for as long as its turns take (a backstop kills it after 20 minutes).
  If the Inngest Dev Server cuts long steps, lower `CLI_CHUNK_TURNS` or move to a detached CLI polled with
  `step.sleep` (the CI gate's pattern), as the plan's fallback says.
- **The finish turn**: after the finish tool the agent should stop; if it keeps calling tools, the result is already
  stored and the stage ends after the chunk anyway.
- **A restart onto the API key** starts the API conversation at turn 1, so its agent log rows can overwrite the plan
  chunk's rows at the same positions (the same happens today when auto failover restarts a stage).
- **Sign-in from Settings** spawns `claude auth login` detached; if it waits for a pasted code instead of the browser
  callback, run the command in a terminal (Setting it up, step 2).

## Files

| File | What it holds |
| --- | --- |
| `lib/cli-agents-config.ts` | Pure, client-safe: routes, `cliAgentsAllowed`, auth parsing, `resolveRoute`, `planLimitAction`, plan usage formatting. Tested. |
| `lib/cli/claude-config.ts` | Pure: `claudeChunkArgs`, the stream-json reader, `classifyClaudeChunk`. Tested. |
| `lib/cli/index.ts` | Server: CLI home, machine id and local state, binary detection and sign-in (cached 60 s), `childEnv`, `cli_settings`, `claudeMachineState`. |
| `lib/cli/claude-run.ts` | Server: one chunk (spawn, stop polling, deadline), the MCP bearer. |
| `lib/cli/stage-mcp.ts` | Server: the stage's tools as an MCP registry; logs each call, stores the finish result. |
| `lib/cli/plan-view.ts` | Server: what Settings shows. |
| `lib/mcp-protocol.ts` | Pure: the MCP JSON-RPC handler. Tested. |
| `app/api/mcp/runs/[runId]/route.ts` | The endpoint the CLI calls. |
| `scripts/cli-isolation-check.mts` | The isolation check (uses your plan: run it only when you decide to). |
