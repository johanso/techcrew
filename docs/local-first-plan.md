# Local-first plan (v0.9)

TechTeam becomes an app you run on your own computer: `git clone`, `npm install`, `npm run dev`, and it works. The only
remote services left are **GitHub** (repositories, pull requests, CI) and the **model providers** you choose. Moving to
another computer is a backup and a restore.

For the current state see [status.md](status.md); for the phases around this one see [roadmap.md](roadmap.md).

- [Decisions](#decisions)
- [End state](#end-state)
- [Phases](#phases)
- [Risks](#risks)
- [Out of scope](#out-of-scope)

---

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
| Configuration | ~25 variables | None required; a first-run wizard |

A new user needs Node, git and a GitHub account. Optional: Claude Code, WSL2 (sandbox), model API keys.

## Phases

Each phase is a branch and a pull request: `npm run check` and `npm run build` pass, the change is under **Unreleased**
in the changelog, and AGENTS.md and `docs/` are updated. Read `node_modules/next/dist/docs/` before Next.js-specific code.

### Phase 0 — Safety net
- Validate v0.8 live: the isolation check and one real Developer run on the plan (spends plan usage: ask first).
- `npm run smoke`: one card through the whole pipeline in simulated mode against a test repository. Not part of
  `check` (it touches GitHub).
- Done when the smoke passes and v0.8 is validated.

### Phase 1 — Remove remote services
- Delete `switch-*`, `jobs.ts`, `app/api/switch-trust`, `inngest/switch-weekly`, the Switch settings form,
  `PUBLIC_APP_URL`; clean docs and `.env.example`.
- Leave the Switch tables and columns for the final migration (never edit an applied migration).
- Done when the app runs without `JOBS_*`, `SWITCH_*` or a tunnel and the smoke passes.

### Phase 2 — Local files
- `lib/storage.ts` writes under the data folder (overridable). Database rows hold relative keys only.
- A one-time script copies today's objects from S3.
- Done when logos, screenshots and references work without `S3_*`.

### Phase 3 — Local Postgres
- Embedded Postgres started by `npm run dev` next to Inngest; migrations run on start; `DATABASE_URL` still works.
- First prove it starts on Windows; PGlite is the fallback.
- Done when `npm run dev` brings everything up from nothing.

### Phase 4 — Identity with GitHub
- Device flow with a public client id shipped in the repo (overridable), so there is no client secret and nobody
  creates their own OAuth App. Sign-in and repository access are one step; `users` keeps one row.
- Remove `AUTH_*`, sign-in and sign-up pages, social sign-in and `user-sync`.
- The existing owner adopts their data at first sign-in.
- Local security: listen on `127.0.0.1` only, a signed session cookie with a secret generated on first start, origin
  checks on actions.
- Done when you can sign in from scratch and see your repositories.

### Phase 5 — Backup, restore and your current data
- While the old credentials still work: import the current database and files into the local installation.
- `npm run backup` (a `pg_dump` plus the files, one archive, no secrets by default) and `npm run restore` (warns when
  runs are in flight).
- Done when a backup restored under a clean profile shows the same projects, board and agents.

### Phase 6 — First run and easy operation
- First-run wizard and `npm run doctor` (Node, git, GitHub, Claude Code, database, sandbox).
- A stable mode (`npm run build && npm start`) for long runs; check what happens to runs in flight when Inngest
  restarts and resume them at start if needed.
- A README quickstart tested on a clean profile.
- Done when someone without context gets it running from the README alone.

### Phase 7 — Model routes
- A configurable fallback order when a plan or a company runs out (`planLimitAction`, `fallbackProvider`). Providers and
  models are not touched.
- Done when an exhausted plan moves to the next one in the chosen order and the agent log says so.

### Phase 8 — Pluggable sandbox
- 8a: an interface with three modes (off, Docker, bubblewrap); previews on `localhost` instead of a domain and Caddy;
  `deploy/` becomes optional.
- 8b: WSL2 with bubblewrap; the preview's server and the Tester's browser run in one sandbox with no outside network.
  Install runs with `--ignore-scripts` unless a package needs its script.
- Done when the Tester takes screenshots of a preview without Docker.

### Final cleanup
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
