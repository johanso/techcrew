# Local-first plan (v0.9)

TechTeam becomes an app you run on your own computer: `git clone`, `npm install`, `npm run dev`, and it works. The only
remote services left are **GitHub** (repositories, pull requests, CI) and the **model providers** you choose. Moving to
another computer is a backup and a restore.

For the current state see [status.md](status.md); for the phases around this one see [roadmap.md](roadmap.md).

- [Status](#status)
- [Decisions](#decisions)
- [End state](#end-state)
- [Phases](#phases)
- [Risks](#risks)
- [Out of scope](#out-of-scope)

---

## Status

As of 2026-11-24, on `main`:

| Phase | State | Notes |
| --- | --- | --- |
| 0 Safety net | **Not done** | `npm run smoke` doesn't exist: it needs a throwaway test repository on GitHub. The v0.8 live validation (agents on the Claude plan) was done by the owner in real use, not by the isolation script. |
| 1 Remove remote services | Done | Hosted auth, Switch Trust, Cloudhike Jobs and the tunnel are gone from the code. Their tables and columns stay (see the final cleanup). |
| 2 Local files | Done | `lib/storage.ts` writes under the data folder; `npm run storage:import-s3` copies an old bucket once. |
| 3 Local Postgres | Done | Embedded Postgres 18 (`embedded-postgres`) or `DATABASE_URL`. PGlite was never needed. |
| 4 Identity with GitHub | Done | Device flow or personal access token, signed cookie, loopback only, host guard. |
| 5 Backup and restore | Done | `npm run backup` / `npm run restore`, no secrets in the archive. |
| 6 First run and easy operation | Done, with changes | `npm run doctor`, `npm run start:local` (stable mode), a **Get started** checklist on the Overview instead of a wizard, and a sweeper that ends runs left behind when TechTeam stopped. The README quickstart was run on a clean clone. |
| 7 Model routes | Done | `workspaces.ai_fallback_order`; the credit failover, the board's switch and retry and the plan-limit "Switch company" policy follow it. |
| 8 Pluggable sandbox | Done (Docker local), verified on Docker Desktop for Windows | The sandbox runs on this computer's Docker (`npm run sandbox:setup`), previews on `127.0.0.1`. WSL2 + bubblewrap dropped from this phase. |
| Final cleanup | **Pending** | One migration dropping the unused tables and columns listed in [data-model.md](data-model.md#unused-tables-and-columns), and the stack rows that still mention them. |

## Decisions

- **One user per installation.** No accounts, no multi-user. The "login" is the GitHub connection.
- **Models stay as they are**: OpenAI, Anthropic and OpenRouter, each with its own API key, plus Claude Code on the
  owner's plan ([cli-agents.md](cli-agents.md)). No new provider, no Codex route. The one addition is a configurable
  fallback order for when a plan runs out (for example Claude plan, then OpenRouter).
- **GitHub is the only required remote service.** CI on the pull request (GitHub Actions) is the base verification;
  the sandbox is optional.
- **Postgres stays** (schema, row locks, partial unique indexes and jsonb all depend on it): embedded and started by
  `npm run dev`, or any Postgres through `DATABASE_URL`.
- **Reviewing needs no sandbox.** Reviewer, Security and the Lead read the diff through the GitHub API. Only the
  Developer's `run_tests` / `run_build` and the Tester's preview and browser need one.
- **The Tester's visual comparison stays**, last (phase 8), because it needs the sandbox.
- **Never move secrets by default.** Backups leave out tokens and API keys; on a new computer you reconnect GitHub and
  paste your keys again (an optional passphrase-protected export exists).

## End state

| Piece | Before | After |
| --- | --- | --- |
| Identity | CloudHike hosted auth | GitHub sign-in (device flow), one local user |
| Database | Remote Postgres | Embedded Postgres, or `DATABASE_URL` |
| Files | S3 | `~/.techteam/data/files` (relative keys in the database) |
| Jobs and scans | CloudHike Jobs, Switch Trust, tunnel | Removed (the rule-based Trust Score stays) |
| Inngest | Dev Server | Unchanged (already local) |
| Sandbox | VPS with gVisor and Caddy | Modes: off (CI), WSL2 + bubblewrap, Docker; previews on `localhost` |
| Configuration | ~25 variables | None required; `npm run doctor` and a Get started checklist |

A new user needs Node, git and a GitHub account. Optional: Claude Code, WSL2 (sandbox), model API keys.

## Phases

Each phase is a branch and a pull request: `npm run check` and `npm run build` pass, the change is under **Unreleased**
in the changelog, and AGENTS.md and `docs/` are updated. Read `node_modules/next/dist/docs/` before Next.js-specific code.

### Phase 0 — Safety net (partly done)
- `npm run smoke` exists: one card through the whole pipeline in simulated mode against a throwaway repository, on its
  own stack, with cleanup (docs/testing.md#smoke-test). It runs by hand, not in `check` (it touches GitHub).
- v0.8 live validation: the owner used agents on the plan in real use. The isolation check
  (`scripts/cli-isolation-check.mts`, spends plan usage) has still not been run.
- Done when the isolation check has run as well.

### Phase 1 — Remove remote services (done)
- Delete `switch-*`, `jobs.ts`, `app/api/switch-trust`, `inngest/switch-weekly`, the Switch settings form,
  `PUBLIC_APP_URL`; clean docs and `.env.example`.
- Leave the Switch tables and columns for the final migration (never edit an applied migration).
- Done when the app runs without `JOBS_*`, `SWITCH_*` or a tunnel and the smoke passes.

### Phase 2 — Local files (done)
- `lib/storage.ts` writes under the data folder (overridable). Database rows hold relative keys only.
- A one-time script copies today's objects from S3.
- Done when logos, screenshots and references work without `S3_*`.

### Phase 3 — Local Postgres (done)
- Embedded Postgres started by `npm run dev` next to Inngest; migrations run on start; `DATABASE_URL` still works.
- First prove it starts on Windows; PGlite is the fallback.
- Done when `npm run dev` brings everything up from nothing.

### Phase 4 — Identity with GitHub (done)
- Device flow with a public client id shipped in the repo (overridable), so there is no client secret and nobody
  creates their own OAuth App. Sign-in and repository access are one step; `users` keeps one row.
- Remove `AUTH_*`, sign-in and sign-up pages, social sign-in and `user-sync`.
- The existing owner adopts their data at first sign-in.
- Local security: listen on `127.0.0.1` only, a signed session cookie with a secret generated on first start, origin
  checks on actions.
- Done when you can sign in from scratch and see your repositories.

### Phase 5 — Backup, restore and your current data (done)
- `npm run backup` writes one `.tar.gz` (rows as JSON lines read from a read-only snapshot, the files, a manifest; no
  secrets; `--with-s3` also collects the old bucket) and `npm run restore` fills an empty database from it in one
  transaction. It uses no `pg_dump`, so it needs no Postgres tools and works against any `DATABASE_URL`. Backup warns
  about runs in flight. The owner pulls the old remote data from a computer that reaches it: docs/setup.md.
- Done when a backup restored under a clean profile shows the same projects, board and agents.

### Phase 6 — First run and easy operation (done)
- First-run wizard and `npm run doctor` (Node, git, GitHub, Claude Code, database, sandbox).
- A stable mode (`npm run build && npm start`) for long runs; check what happens to runs in flight when Inngest
  restarts and resume them at start if needed.
- A README quickstart tested on a clean profile.
- Done when someone without context gets it running from the README alone.

### Phase 7 — Model routes (done)
- A configurable fallback order when a plan or a company runs out (`planLimitAction`, `fallbackProvider`). Providers and
  models are not touched.
- Done when an exhausted plan moves to the next one in the chosen order and the agent log says so.
- Done: per-workspace `ai_fallback_order` (Settings → AI → This workspace only); `fallbackProvider` takes it from the
  credit failover, the board's switch and retry and the plan-limit "Switch company" policy. The log and the bell name
  the company moved to.

### Phase 8 — Pluggable sandbox
- Done (v0.10): the mode is decided from the environment (`lib/sandbox/mode.ts`): `remote` when `SANDBOX_DOCKER_HOST` is
  set (unchanged), else `local` on this computer's Docker, else unavailable with a reason (Docker missing or stopped,
  Windows containers, images missing). Previews on `http://127.0.0.1:<port>` through a forwarder container, no Caddy, no
  domain; the Tester's browser works in both; `deploy/` is optional. Install runs with `--ignore-scripts` locally
  unless the owner allows scripts. Link captures stay remote-only. Details: [sandbox.md](sandbox.md#local-mode).
- Dropped from this phase: **WSL2 with bubblewrap.** The owner chose "local Docker first". Docker Desktop is the common
  tool, and bubblewrap would be a second isolation layer to build, test and keep honest on a platform where the
  compensations already differ (no network namespaces for the preview's browser without more plumbing). It can come back
  as its own phase once local Docker is proven.
- Done when the Tester takes screenshots of a preview without a VPS.

### Final cleanup (pending)
- A migration dropping the unused Switch and auth tables and columns; update the roadmap and the stack table in AGENTS.md.

## Risks

| Risk | Mitigation |
| --- | --- |
| Losing your current data | Phase 5 imports it before anything is closed; keep the current `.env` until confirmed |
| Embedded Postgres won't start on Windows | Prove it first; PGlite fallback; `DATABASE_URL` always available |
| A local app holding GitHub tokens reachable from a web page | Loopback only, signed cookie, origin checks (phase 4) |
| Weaker isolation than gVisor | Documented; the default mode runs no code locally |
| Inngest loses runs on restart | Checked in phase 6 |
| Windows Home has no Windows Sandbox or Hyper-V | WSL2 is the isolation route; Docker optional |

## Out of scope

Multi-user hosting, Google sign-in, a GitHub App and webhooks, a desktop shell (Tauri/Electron), a Codex route,
direct DeepSeek, cloud sandboxes, the Designer agent.
