# Plan: agents on the owner's plans through local CLIs (Claude Code, Codex)

Status: approved direction (2026-11-20), not started. Written for the agent that implements it. Read `AGENTS.md`
and `CLAUDE.local.md` first; every rule there applies (branch first, noreply commit identity, `npm run check` +
`npm run build`, docs current, **ask the owner before any live model run**, never print env values, no
`isolation: "worktree"` while `npm run dev` runs).

## 1. Context

TechTeam stays the web app it is today (Next.js, Cloudhike Postgres + auth, S3, Inngest, the VPS sandbox). Nothing
is packaged as a desktop app, and the earlier "local desktop app" idea is dropped.

What's new: an agent can run on the **owner's subscription** through the official CLI installed on the computer
where TechTeam runs (**Claude Code** with a Claude Pro/Max login, **Codex** with a ChatGPT login), next to the API
providers that exist today (OpenRouter, OpenAI, Anthropic). **The agent's config doesn't change**: an agent keeps
its model (say Claude Sonnet); a switch in Settings decides the **route** its stages take: the owner's plan through
the CLI, or the API key as today (§3.1).

- **Only when TechTeam runs locally.** A deployed instance (Vercel or any server) never offers, detects or spawns a
  CLI. The owner runs TechTeam locally on two computers: the **Mac** and a personal **Windows** PC (clone the repo,
  `npm install`, `npm run dev`, which starts the app and Inngest together). Windows has only **Claude Pro** (no Codex there).
- Using one's own CLI and login on one's own machine, for oneself, is normal use. Offering a claude.ai login to
  *other people* inside a product isn't allowed without Anthropic's approval: if TechTeam is ever offered to others,
  plan agents must stay a local, owner-only feature. Put this in `docs/security.md`.
- **The Mac's Claude Code is signed in to the owner's employer (Team organization).** TechTeam must never use that
  login. See §3.3.

## 2. Decisions made by the owner

1. Spend is measured only where it costs money. API agents keep cost tracking and budgets exactly as today. Plan
   agents record runs, turns and tokens, plus the CLI's reported API-equivalent cost as a reference only ("≈ $0.40
   at API prices"), never counted as spend. Their brake is max turns, not a budget.
2. **The model is the agent's; the route is the computer's.** Turning a plan switch on or off, running out of the
   plan's usage window, or opening TechTeam on the other computer never edits an agent. Models change only in each
   agent's AI Team config (the existing out-of-credit auto failover stays the only automatic exception).
3. **When the plan's usage window runs out** (Claude's ~5-hour limit), the owner's setting decides (§3.4): wait
   for the reset (default when there's no API key for that company), continue on the API key, or the existing
   company failover.
4. Settings shows CLIs and API keys in **one AI section with two groups**, not tabs.
5. Fonts are named by the owner in the card description; agents never pick one.

## 3. Design

### 3.1 When CLIs are available

- **No env var to remember: detection plus a switch.** `cliAgentsAvailable()` (server-only) is true only when the
  app runs locally: no hosted-platform marker (`process.env.VERCEL` unset; add others if needed) **and** the app's
  URL is a local address (reuse the local-address check behind `publicAppUrl` in `lib/jobs.ts`). Only then does the
  app look for CLIs at all. `AGENTS_LOCAL_CLI=false` in `.env` is a kill switch that forces it off (add it to
  `.env.example` with a comment); there is no "on" variable.
- **The switch**: Settings → AI → "Plans on this computer" has one switch per detected CLI: "Use my Claude plan for
  Claude models" (Claude Code) and "Use my ChatGPT plan for OpenAI models" (Codex). Stored per user **and per
  computer** (key it by a machine id kept in TechTeam's CLI home, §3.3), since the database is shared and the other
  computer may have no CLI. Off by default; turning it on runs the account check (§3.3) first.
- **Route resolution** (pure, tested: `resolveRoute(model, machine)`), at the start of every stage:
  - An Anthropic model → **plan via Claude Code** when available here, switched on, signed in to the confirmed
    account and the model is usable on that plan; else **API key** (as today).
  - An OpenAI model → **plan via Codex** under the same conditions; else API key.
  - OpenRouter models → always API key.
  - No usable route (plan off or unusable, and no key) → `pipelineModelProblem` refuses Run before it starts, naming
    the agent and the fix ("Switch on your Claude plan in Settings, or add an Anthropic key").
  The route is pinned per stage in `LoopState` like the model is; it's recorded on the stage (`billing`).
- Which models a plan includes: map the CLI's `subscriptionType` to the models it can use (e.g. whether Pro includes
  Opus in Claude Code: verify against current docs, and treat a CLI "model not available" error as "route to API key
  next time" plus a stage restart on the API key when one exists).
- Per CLI, `detectCli(kind)`: finds the binary (known locations per OS, see §3.6, plus an optional
  `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH`), reads the version, and reads the login status with TechTeam's config home
  (§3.3). Cache ~60 s; Settings has *Check again*.
- On a deployed instance, or with the switch off, everything works as today (API keys) and nothing about CLIs is
  shown. Auto pickup skips a card whose agents have no usable route (like a missing key today).
- The agent config lives in the shared database, but the CLI and its login live on each computer. Every check is
  per machine, at Run and again at the start of every stage.

### 3.2 Permissions stay tools: TechTeam's tools over MCP

- The CLI gets **no built-in tools** and **only TechTeam's tools**, served by a new MCP endpoint in the app:
  `app/api/mcp/runs/[runId]/route.ts` (Streamable HTTP; check the MCP TypeScript SDK docs with Context7). It
  authenticates with a per-run bearer credential (HMAC of run id + stage + round with `TOKEN_ENCRYPTION_KEY`, like the
  Switch agent endpoint credential), valid only while that run and stage are active. The CLI reaches it on
  `localhost`.
- Its tool list is `toolsFor(stage, permissions, …)` from `lib/agent-tools.ts` plus the stage's finish tool. Calls go
  through the same `callTool` path, so `toolStep`, `agent_run_steps` (agent log + live process), references, skills,
  merge tools, sandbox tools and `add_dependency` behave exactly as for API agents. The finish tool stores the stage
  result the way `runStageTurn` does. Keep the registry generic: later, read-only repo-backed knowledge tools (see §6)
  must fit without a new endpoint.
- Prompt: the same `systemPrompt` + stage brief (Claude: `--system-prompt` or `--append-system-prompt`; Codex: verify
  the equivalent). Send it on stdin or from a file, never as a command-line argument (Windows' ~32K limit).

### 3.3 Isolation and the right account (hard requirements)

- **TechTeam's own CLI login.** Run every CLI with its own config home outside the project folder (Turbopack watches
  the project): `CLAUDE_CONFIG_DIR=~/.techteam/cli/claude` and `CODEX_HOME=~/.techteam/cli/codex` (`%USERPROFILE%\…`
  on Windows; overridable with `TECHTEAM_CLI_HOME`). The owner signs in there once with their **personal** account:
  Settings → *Sign in* runs `claude auth login` with that env and shows the CLI's URL/code. This keeps the
  employer's login untouched and keeps the agents away from the owner's global MCP servers, hooks, `CLAUDE.md` and
  skills, which live in the default config home. Verify on macOS (Keychain) and Windows that this login is really
  separate and that signing in for TechTeam doesn't sign the owner's normal CLI out or switch its account.
- **Second layer, flags** (seen in `claude --help` 2.1.326): `--strict-mcp-config --mcp-config <json>`, `--tools ""`,
  `--setting-sources` (none of user/project/local), `--disable-slash-commands`, `--permission-prompts none`,
  `--output-format stream-json`, `--model`, `--session-id`, `--resume`. `--bare` skips keychain reads, so it likely
  can't use a plan login: verify. Verify `--max-turns` (not shown in that help output).
- **Account check.** `claude auth status --json` (fields in 2.1.326: `loggedIn`, `authMethod`, `email`, `orgName`,
  `subscriptionType`, `loginExpiresAt`). Settings shows email · organization · plan; the owner confirms it once
  (stored on the user). Before every stage, if the CLI reports another account or organization, refuse the run
  with a clear message.
- **Isolation test** (a script, run only with the owner's OK because it uses their plan): with a real signed-in CLI,
  prove no user MCP server, hook, `CLAUDE.md` or skill loads (ask the agent to list its tools and instructions) and
  that the owner's work hooks don't receive the session.
- Working directory: an empty folder under `os.tmpdir()/techteam/run-<runId>/`, removed in `finishRun`.

### 3.4 Running a stage

- **Inngest steps stay short and retry-safe**; don't hold one HTTP request for a 20-minute CLI session. Preferred:
  one step per chunk of turns, `claude -p --resume <session-id> --max-turns <k>`, taking the session id from the JSON
  result; between chunks re-check stop/pause like `runStageTurn`. Fallback if resume proves unreliable: spawn the
  CLI detached and poll it with `step.sleep` steps (the CI gate's pattern), kill it on stop.
- The turn limit works as today: wrap-up note three turns before the end (in the next chunk's prompt), last chunk
  asks for the finish tool, `settleOutOfTurns` when the CLI ends without it.
- **Usage, not spend**: parse the CLI's final JSON (`total_cost_usd`, token usage, turns, session id). Store tokens and
  turns; store the equivalent cost separately and never add it to `cost_micros`, budgets or spend. Schema: e.g.
  `billing` (`api | plan`) and `equivalent_micros` on `agent_activity`, with a migration (`db:generate`, read it, the
  dev database is shared with the other computer: additive changes only).
- **Plan limit** (the ~5-hour usage window). Detect the CLI's usage-limit error and its reset time when reported.
  Setting in Settings → AI, per plan: **"When my plan runs out"**:
  - **Wait for the reset** (default when there's no API key for that company): the run pauses with
    `waiting: { kind: "plan_limit", resetsAt }` (Inngest `step.sleepUntil(resetsAt + margin)`; if the CLI gives no
    time, retry every 30 min), the card shows "Your Claude plan resets at 3:40 PM", the bell notifies once, and the
    stage then **resumes the same CLI session** (`--resume`), so no work is lost. Stop still works while waiting.
    Pause/budget checks run again on wake. A long wait never counts toward any timeout that would fail the run.
  - **Continue on the API key** (only offered when that company has a key): the same model continues on the API.
    The stage restarts (a CLI conversation can't move to the API), like today's failover restart; the agent log
    marks the switch. Later stages keep using the API until the plan resets (re-check at each stage start).
  - **Switch company**: the existing auto failover (`moveAgentsToProvider`), which does edit agents: off unless the
    owner chose it.
  Without any of these possible, stop with `failure = { kind: "plan_limit", provider, resetsAt }` and notify.
- **Vision**: references and the Tester's screenshots come back as MCP image content. Verify each CLI passes MCP images
  to the model; if not, mark that CLI's models as not vision-capable so `referenceVisionStages` warns.
- **Config vocabulary**: no new providers. `AGENT_MODELS` gains, per Anthropic/OpenAI model, the CLI model name to
  pass (`--model`) and whether it's plan-capable; `AGENT_ROUTES` (`api`, `claude-plan`, `codex-plan`) lives next to
  `PROVIDERS`. `closestModel`, `agentModelFor`, `fallbackProvider` stay as they are.
- **Simulated mode** keeps working without any CLI.

### 3.5 Two computers, one database

The Mac and the Windows PC share the Cloudhike database, each with its own Inngest Dev Server (`npm run dev`). A run executes on
the computer whose Inngest received it. Risks to handle:
- **Auto pickup runs on both** (each Inngest has the cron). Make starting a run race-safe: today `createRun` /
  `createCardRun` don't visibly lock the card; add a lock or a unique partial index (one active run per task) so two
  computers can't start the same card. Test it.
- Add `AGENTS_AUTO_PICKUP=false` (env) so one computer can opt out of the cron; document "keep auto pickup running on
  one computer".
- The same agent may take the plan route on the Mac and the API route on the Windows PC (or the reverse): that's
  intended. Route resolution runs on the computer that executes the stage (§3.1).

### 3.6 Windows

- Spawn with an argument array, never a shell string. `claude` may be an `.exe` (native installer, preferred) or a
  `.cmd` shim (npm global): a `.cmd` needs `shell: true`, so quote strictly or ask for the native install.
- Look for the CLIs in `~/.local/bin`, Homebrew paths (macOS) and `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`
  (Windows), plus the env overrides.
- Child processes get an allowlisted environment (one helper, `childEnv(extra)`): today the sandbox's `docker` gets
  only `PATH`, `HOME`, `DOCKER_HOST`; on Windows children also need `SystemRoot`, `USERPROFILE`, `APPDATA`,
  `LOCALAPPDATA`, `TEMP`/`TMP`, `PATHEXT`. Never pass the parent's whole env (API keys, DB URL) to a CLI.
- Make sure the repo works on Windows as a dev checkout: `.gitattributes` forces `eol=lf` for sources and fixtures
  (diff3 and skill-catalog tests compare exact text), npm scripts stay shell-neutral, docs that use `set -a && source
  .env` get a Windows/PowerShell variant. Add a `windows-latest` job running `npm run check` to `.github/workflows/ci.yml`.
- `docs/setup.md`: a Windows section (Node version, clone, `.env`, `npm run db:migrate` not needed (shared DB),
  `npm run dev`, Claude Code native install, then Settings → AI → sign in and switch on).
- `npm run dev` already starts the app and Inngest together through `concurrently` (done on this branch); check it
  on Windows.

## 4. What changes, page by page

Pages not listed don't change (Overview, Pull requests, Activity, Workspaces, sign-in).

| Page | Change |
| --- | --- |
| **Settings → `#ai`** | One "AI" section, two groups. **Plans on this computer** (only when `cliAgentsAvailable()`): a row per CLI with its on/off switch ("Use my Claude plan for Claude models"), the "When my plan runs out" choice (§3.4), installed + version, signed in as email · organization · plan, login expiry, the agents using it, *Sign in* / *Sign out* (TechTeam's config home) / *Check again*, and the install command for this OS when missing. **API keys**: as today; configured providers first, the others under "Add another provider". Remove the "This workspace only" keys if the owner agrees (single user; ask). Keep the auto failover toggle. |
| **Settings → `#usage`** | "API spending this month" (as today) + "Plan usage this month" (runs, turns, tokens). |
| **Settings → `#agents`** | Note: auto pickup runs on every computer whose Inngest is up unless `AGENTS_AUTO_PICKUP=false`. |
| **AI Team** | The config dialog doesn't change (company + model as today). Each agent card shows its route on this computer as a chip: "Your Claude plan" or "API key" (and "Waiting for your plan · resets 3:40 PM" while paused). `BudgetMeter` stays (it measures API spend only, which a plan-routed agent doesn't add to). Stat tile "Monthly spending" → "API spending this month", hint "N agents on your plans". Spending panel: plan agents show runs/turns/tokens. |
| **Board** | Run log: plan stages show "Your Claude plan · 12 turns · 180K tokens (≈ $0.40 at API prices)". Card status "Waiting for your plan · resets at 3:40 PM" (Stop still available); a `plan_limit` failure notice when the run had to stop. Run refusals from §3.1. |
| **Metrics** | "Cost per delivered card" = API spend only, labeled so; a hint "Runs on your plans: N"; spend by agent lists API agents, plan agents by turns/tokens. Update `run-metrics.ts` + tests. |

## 5. Tests and docs

- Unit tests (pure parts): CLI argument builder, final-result/usage parser, plan-limit classifier, auth-status parser
  and account check, `cliAgentsAvailable` (hosted marker, local URL, kill switch), `resolveRoute` (every model ×
  switch × key × plan combination), the plan-limit policy (wait / API / failover / stop), MCP tool listing per stage/permissions, the run-start race guard. No unit
  test spawns a real CLI.
- Live test (ask the owner first): one card on "Sandbox demo" with the Developer on a Claude model routed through
  the plan and the rest on OpenRouter; then the same on the Windows PC. The wait-for-reset path is tested with a
  simulated limit error, not by exhausting the plan.
- Docs: `AGENTS.md` (stack table: AI row; folder structure; pipeline rules), `README.md`, `CHANGELOG.md` (Unreleased),
  `docs/roadmap.md` (this becomes the next version; deploy moves to Later), `docs/setup.md` (Windows + CLI),
  `docs/architecture.md`, `docs/security.md`, `docs/features.md`, `docs/data-model.md`, `docs/testing.md`.

## 6. Later (not in this plan): Brain lives in the repository

For v0.8 "Brain" (project memory): Markdown in the linked repository (e.g. `.techteam/memory/`: a short
always-loaded index plus topic files), so both computers share it through GitHub and other tools can read it. Agents
read it with the skills machinery, built together with Project skills (`.agents/skills/`, `.claude/skills/`). Agents
only *propose* memory changes inside their card's PR; they enter memory when the owner merges (tool output is
untrusted and would otherwise poison later runs).

## 7. Done means

`npm run check` and `npm run build` pass (also on the Windows CI job); simulated mode runs end to end; on a
hosted or non-local URL (or with `AGENTS_LOCAL_CLI=false`) nothing about CLIs appears or runs; docs updated; the isolation test passed and one live
run done with the owner's OK; one PR (the owner opens it in the GitHub UI: description to the clipboard with
`pbcopy`).
