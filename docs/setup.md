# Setup

Everything you need to run TechTeam locally, and what each setting does.

- [Prerequisites](#prerequisites)
- [1. Install](#1-install)
- [2. Environment variables](#2-environment-variables)
- [3. External services](#3-external-services)
- [4. Create the database tables](#4-create-the-database-tables)
- [5. Run](#5-run)
- [6. First-run walkthrough](#6-first-run-walkthrough)
- [Agents on your Claude plan (optional)](#agents-on-your-claude-plan-optional)
- [A second computer (Windows)](#a-second-computer-windows)
- [Production notes](#production-notes)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 or newer | Runs Next.js 16; scripts use `node --env-file`. |
| npm | bundled with Node | Package manager (a `package-lock.json` is committed). |
| PostgreSQL | 14+ | App database. Optional: the embedded one starts with `npm run dev`. |
| A GitHub account | — | Signing in with it is also what gives agents access to your repositories. |

## 1. Install

```bash
npm install
cp .env.example .env
```

`.env` is gitignored. **Never put real values in `.env.example`** — it is committed.

## 2. Environment variables

All variables live in `.env`. Restart `npm run dev` after changing them.

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | host guard, cookies, self calls | Origin of the app, e.g. `http://localhost:3000`. The app listens on `127.0.0.1` only; requests for another host name are refused unless it is this URL's host. `https` makes cookies `Secure`. |
| `DATABASE_URL` | no (unset = embedded Postgres) | Drizzle (`db/index.ts`, `drizzle.config.ts`) | Postgres connection string. |
| `GITHUB_CLIENT_ID` | no | `lib/github-client-id.ts` | Client id of the GitHub OAuth App used for sign-in. Default: the project's own app. Public; there is no client secret. Set it only for your own app (below). |
| `TOKEN_ENCRYPTION_KEY` | no | `lib/secrets.ts` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts GitHub tokens and AI provider keys at rest. Unset, a key is generated in `<TECHTEAM_DATA_DIR>/encryption.key`. **Moving to another computer needs that file (or this value)**; without it, reconnect GitHub and enter the AI keys again. **Don't change or remove it once keys are saved**: what the old key encrypted can't be read any more (starting with the saved AI keys and the GitHub token) and you sign in and enter the keys again. The app keeps working meanwhile: an unreadable AI key counts as not set (Settings → AI shows a notice on it; saving a key replaces it) and an unreadable GitHub token counts as an expired connection. |
| `TECHTEAM_DATA_DIR` | optional | `lib/storage.ts` | Folder for local data. Files (workspace logos, the Tester's screenshots, card references) go in `<dir>/files`. Default `~/.techteam/data`. |
| `OPENAI_API_KEY` | optional | `lib/ai-keys.ts` | Server-wide fallback; users normally save their own key once in Settings → Your account → AI keys. Agents on GPT models; **Draft with AI** and AI-assisted trust scans (on `gpt-6.1-sol`). Without any provider key the page works with default instructions and rule-based scans. Model cost is charged to the agent's monthly budget. |
| `ANTHROPIC_API_KEY` | optional | `lib/ai-keys.ts` | Server-wide fallback, as above. Agents on Claude models (Opus / Sonnet / Haiku 5.5). Also drafting and trust scans (on `claude-sonnet-5-5`) when `OPENAI_API_KEY` isn't set. A Console API key (pay as you go); a Claude.ai subscription can't be used. |
| `OPENROUTER_API_KEY` | optional | `lib/ai-keys.ts` | Server-wide fallback, as above. One key for the Google, DeepSeek, Z.ai, xAI and Moonshot models (needs OpenRouter credit). Drafting and trust scans run on it (`deepseek/deepseek-v4-pro-0813`) only when neither other key is set. |
| `AGENTS_SIMULATED` | no | `lib/agent-simulated.ts` | Local testing. `true` runs the agent pipeline with scripted agents: no model calls and no spend, but real GitHub work on the linked repo (a branch, one note file `agent-simulations/<branch>.md`, a pull request). Each turn waits 4 s so you can watch the card move. Leave `false` in production. |
| `SANDBOX_DOCKER_HOST` | for the sandbox | `lib/sandbox/docker.ts` | Docker host for agent sandboxes: `ssh://<user>@<ip>` (or an `~/.ssh/config` alias) for a VPS set up with `deploy/setup.sh`, `unix:///var/run/docker.sock` when the app runs on it. Unset: Settings → Sandbox can't be switched on. See [sandbox.md](sandbox.md). |
| `SANDBOX_IMAGE` | no | `lib/sandbox/docker.ts` | Container image for sandboxes. Default `node:24-bookworm`. |
| `INNGEST_EVENT_KEY` | production | `lib/inngest/client.ts` | Inngest Cloud event key. Not needed locally (the Dev Server is used). |
| `INNGEST_SIGNING_KEY` | production | Inngest `serve()` | Verifies requests from Inngest Cloud to `/api/inngest`. Not needed locally. |
| `INNGEST_DEV` | no | Inngest SDK | Set to `1` to force Dev Mode, `0` to force Cloud Mode. If unset, the SDK (v3) infers Dev Mode unless the environment looks like production (`NODE_ENV=production`, Vercel/Netlify production, …). |

What happens when an optional group is missing:

- **No client id at all** (only if the shipped default is emptied) → `/sign-in` explains how to set `GITHUB_CLIENT_ID`; the personal-token form still works.
- **`TOKEN_ENCRYPTION_KEY` set but not 32 bytes of base64** → signing in fails with an error in the server log. Unset it to use the generated key.
- **Inngest Dev Server not running (locally)** → the board's **Run** action fails with
  "Is the Inngest Dev Server running? Start the app with `npm run dev`." Nothing else is affected.

## 3. External services

### PostgreSQL

#### Database

By default you need nothing: with `DATABASE_URL` unset, `npm run dev` (or `npm run db:local`) starts an embedded
Postgres 18 (the `embedded-postgres` package, about 110 MB downloaded by `npm install`), creates the database on the
first run and applies the pending migrations. It listens on `127.0.0.1` only, port 54329 (`TECHTEAM_PG_PORT`), with a
password generated on first start and kept in `<data dir>/postgres.secret`. Data lives in `<data dir>/postgres`, where
the data dir is `TECHTEAM_DATA_DIR` or `~/.techteam/data`. `npm run db:migrate` and `db:studio` work against it while
it runs. To reset, stop TechTeam and delete the `postgres` folder and `postgres.secret`. No `pg_dump` is shipped: back
up with `npm run backup` (see [Moving to another computer](#moving-to-another-computer--bringing-your-data-from-the-old-setup)).
After a hard stop the next start removes the stale lock by itself.

To use your own database, set `DATABASE_URL`; nothing embedded starts. Any Postgres you can reach works. Examples:

```bash
# Docker
docker run -d --name techteam-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
```

`drizzle.config.ts` restricts Drizzle to the `public` schema (`schemaFilter: ['public']`); a database that still has the
old hosted auth service's `auth` schema keeps it untouched.

### Signing in with GitHub

Sign-in is GitHub's **device flow**, so there is no password, no sign-up, no callback URL and no client secret. One step
identifies you and gives agents access to your repositories (scopes `repo read:user`).

The app uses the project's own GitHub OAuth App by default (its public client id is `DEFAULT_GITHUB_CLIENT_ID` in
`lib/github-client-id.ts`): nothing to set up. A client id is public, not a secret.

To use **your own** OAuth App (a fork, or you prefer it):

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App (<https://github.com/settings/developers>).
   Homepage URL: your `NEXT_PUBLIC_APP_URL`. The callback URL is required by the form but unused: any URL works.
2. Open the app and tick **Enable Device Flow**. Do not generate a client secret.
3. Put the client id in `GITHUB_CLIENT_ID` in `.env` and restart.

Alternatively paste a **personal access token** with the `repo` scope under "Use a personal access token instead".
For organization repositories, an org owner may need to approve the OAuth App (GitHub → Organization settings →
Third-party access).

**Existing installation**: run `npm run db:migrate` (adds `users.github_user_id`). The first sign-in on a database with
exactly one user asks whether to adopt that user's data with your GitHub account; answer **Adopt**.

### Local files

Logos are stored under `workspace-logos/<ownerId>/<uuid>.<ext>` in `<TECHTEAM_DATA_DIR>/files` and streamed to their owner
by `/api/workspaces/[id]/logo`; card references under `card-references/<workspaceId>/<taskId>/<uuid>.<ext>` (served by
`/api/workspaces/[id]/references/[referenceId]`, deleted with their card). Back up the folder with the database.

### Inngest

Locally nothing to configure: `npm run dev` starts it next to the app (`npm run inngest:dev` alone starts only it). It runs the Inngest Dev Server (UI on
<http://localhost:8288>) and points it at `http://127.0.0.1:3000/api/inngest` (the app listens on `127.0.0.1` only), where the app's functions are
served. For production see [docs/background-jobs.md](background-jobs.md#production).

### Agent sandbox (optional)

To let the Developer and the Tester run tests and builds: a fresh Ubuntu 24.04 VPS, then as root `bash
deploy/setup.sh` (and `--lock-ssh` once you can log in as `techteam` with a key). Set `SANDBOX_DOCKER_HOST`, turn on
SSH connection reuse for that host (`ControlMaster auto`, `ControlPath ~/.ssh/cm-%r@%h-%p`, `ControlPersist 10m`),
then Settings → Sandbox → save the commands and **Test the sandbox**. Details: [sandbox.md](sandbox.md#setting-up-a-host).

### Built-in agent skills

Nothing to set up: the built-ins are committed in `agent-skills/` and every workspace gets them on first use. To
update one, change its `ref` in `agent-skills/sources.json` (or `npm run skills:sync -- --update <slug>` to take the
upstream's latest commit), run `npm run skills:sync`, review the diff and open a pull request. The sync downloads
public GitHub tarballs (no token) and writes text files only.

## Moving your files from S3

Files used to live in an S3 bucket. To copy them to this computer once, put the old `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` back in `.env` and run `npm run storage:import-s3`. It copies
every object under the same key into `<TECHTEAM_DATA_DIR>/files`, skips files already there, prints the counts and never
deletes anything from S3. Safe to run again.

## Moving to another computer / bringing your data from the old setup

`npm run backup` writes **one** `.tar.gz` (every table as JSON lines, the stored files, a manifest) and
`npm run restore` puts it into an **empty** database. Both need the system `tar` (Windows 10+, macOS and Linux have it).
The database is only read; the archive never holds secrets (GitHub tokens, AI keys, Switch and CLI settings, the model
cache): after restoring, **sign in with GitHub and enter your AI keys again**. The user you restore is recognized by the
GitHub account of their old saved connection (`users.github_user_id` is filled in the archive, never in the source).

**Your data is still in the old remote database and S3 bucket.** On a computer that can reach them (this repository
installed, `npm ci` done), set the old `DATABASE_URL` and `S3_*` variables for this one run only, and keep them out of
the new setup's `.env`:

```bash
# bash; PowerShell: $env:DATABASE_URL="..." etc. Needs S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_ENDPOINT)
DATABASE_URL=postgresql://... S3_BUCKET=... npm run backup -- --with-s3
```

`--with-s3` copies every object of the bucket (read only, nothing is deleted there) next to the local files. Copy the
`techteam-backup-<date>.tar.gz` it prints to the new computer, then there:

```bash
npm run dev                      # or npm run db:local: the embedded database must be running (and without DATABASE_URL set)
npm run restore -- techteam-backup-<date>.tar.gz    # in a second terminal
```

Then open the app, **Continue with GitHub** and enter your AI keys (Settings → AI).

**Between computers** it is the same: `npm run backup` on the old one (it reads the embedded database, which must be
running), `npm run restore -- <file>` on the new one. Keep `<TECHTEAM_DATA_DIR>/encryption.key` out of it: nothing
encrypted travels.

Rules and limits:
- Restore **never overwrites**: it refuses a database that has a user or a workspace. With `DATABASE_URL`, run
  `npm run db:migrate` first (the embedded database migrates itself on start). An archive from a **newer** TechTeam is
  refused (update first); an older one restores, new columns take their defaults.
- All rows go in one transaction and the counts are checked against the manifest: any problem restores nothing. Files are
  copied first (existing identical files are skipped, different ones are kept and reported), so running it again is safe.
- Agent runs that were queued or running when you backed up **will not continue** on the new computer. The backup warns
  (and needs `--yes` when it isn't run in a terminal); after restoring, use **Stop agents** on those cards, then Run them again.
- The archive is treated as untrusted: only `manifest.json`, `tables/*.jsonl` and `files/**` are accepted, links and odd
  names are refused, and it is unpacked into a temporary folder in the data folder, never straight into place.
- Chat history of agent runs (`agent_run_messages`) can be large; it is streamed, never loaded whole, but the archive and
  its temporary copy need free disk space.

## 4. Create the database tables

```bash
npm run db:migrate
```

This applies the SQL migrations in `drizzle/` that the database hasn't run yet (on a fresh database: all of them,
starting with `0000_baseline.sql`, which creates every table). Applied migrations are recorded in
`drizzle.__drizzle_migrations`.

**Database created with `db:push` before migrations existed** (any copy older than November 2026): its tables already
exist, so run `npm run db:baseline` once. It marks the migrations as applied without running them. After that,
`npm run db:migrate` as usual. More in [docs/data-model.md](data-model.md#schema-changes).

## 5. Run

```bash
npm run dev            # http://localhost:3000 + the Inngest Dev Server (needed for the board's Run action)
```

## 6. First-run walkthrough

1. Open <http://localhost:3000> (it redirects to sign-in) → **Continue with GitHub**. Type the code shown on the page at github.com and authorize.
2. You land on `/workspaces`, which forwards you to **Create a new workspace** because you have none.
3. Name it, pick an icon (or upload a logo), and pick a repository you can push to. Click **Next**.
4. You're on the workspace **Overview**. Open **Board** in the sidebar: it syncs the repository's open issues
   immediately ("Syncing with GitHub…").
5. Create a card with **New**, drag cards between columns, click a card to edit it, or press ▶ to run it.

## Agents on your Claude plan (optional)

Only when TechTeam runs on your computer. Agents on Claude models can run on your Claude plan through Claude Code
instead of an Anthropic key ([cli-agents.md](cli-agents.md)).

1. Install Claude Code's native build: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux) or
   `irm https://claude.ai/install.ps1 | iex` (Windows PowerShell).
2. Settings → AI → **Plans on this computer** → **Sign in**. Claude Code opens your browser: sign in with your personal
   account (TechTeam keeps this login in `~/.techteam/cli/claude`, apart from the one you use in your terminal). Then
   **Check again**, **Confirm this account** and switch on **Use my Claude plan for Claude models**.
3. Agents on Claude models now show **Your Claude plan** on the AI Team page.

To turn the feature off on a computer, set `AGENTS_LOCAL_CLI=false` in its `.env`.

## A second computer (Windows)

The database lives wherever `DATABASE_URL` points; a second checkout shares everything (workspaces, cards, agents) only if both use it.

1. Install Node.js 22+ and Git, then clone the repository and `npm install`.
2. Copy `.env` from your first computer (same `DATABASE_URL`) and the data folder's `encryption.key` (or the same `TOKEN_ENCRYPTION_KEY`); sign in with the same GitHub account. Don't run
   `npm run db:migrate` there for a shared database: the first computer already did.
3. `npm run dev` starts the app and Inngest, as on macOS.
4. Auto pickup runs on every computer whose Inngest is up: keep it on one by setting `AGENTS_AUTO_PICKUP=false` in the
   other's `.env`. A card can't run on both at once either way.
5. Optional: Claude Code's native build and the plan, as above (Settings shows the PowerShell install command). An
   npm-installed `claude.cmd` is refused; use the native installer.

Scripts in the docs written as `set -a && source .env && set +a && …` are for macOS/Linux shells. In PowerShell, load
the variables with `Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=.' } | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }`
first, or use `node --env-file=.env …`.

## Production notes

- Set `NEXT_PUBLIC_APP_URL` to the public HTTPS origin and register the production callback URLs with GitHub and
  CloudHike.
- Cookies are `Secure` automatically when `NODE_ENV=production`.
- Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, deploy, then sync the app in the Inngest dashboard
  (`https://<your-domain>/api/inngest`).
- Run `npm run db:migrate` against the production database before deploying code that needs the new schema.
  Never `db:push` there.
- Run `npm run check` (types, lint, tests) and `npm run build` in CI before deploying.
- Read [docs/security.md](security.md#known-gaps).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `relation "workspaces" does not exist` (or any table) | Tables weren't created. Run `npm run db:migrate`. |
| `npm run db:migrate` fails with `relation "…" already exists` | The database was created with `db:push`. Run `npm run db:baseline` once, then migrate again. |
| Sign-in says Device Flow is switched off | Your own OAuth App needs **Enable Device Flow** ticked in its settings on GitHub. |
| "Unknown host" (403) | You opened the app under a name that isn't `localhost`, `127.0.0.1` or `[::1]`. Use one of those, or set `NEXT_PUBLIC_APP_URL` to that host. |
| A repository is missing from the picker | Only repositories you can **push** to and that aren't archived are listed (max 300). For org repos, the org may need to approve the OAuth App. |
| Board shows "Reconnect GitHub to bring … issues onto the board" | The workspace owner has no GitHub connection (it was disconnected). Click **Reconnect GitHub** (signs in again). |
| Board shows "Your GitHub connection expired or was revoked" | The token was revoked on GitHub, or the encryption key changed or is missing. Click **Reconnect GitHub**. |
| **Run** fails with "Is the Inngest Dev Server running?" | Start the app with `npm run dev` (it starts Inngest too), or `npm run inngest:dev` if you ran `dev:app`. Without it, the SDK falls back to Inngest Cloud and the placeholder event key is rejected (401). |
| Settings → Sandbox can't be switched on | `SANDBOX_DOCKER_HOST` isn't set (restart the dev server after setting it), or neither a test nor a build command is saved. |
| **Test the sandbox** fails while preparing the checkout | The app can't reach Docker on the host: try `docker -H "$SANDBOX_DOCKER_HOST" info` from the same machine (SSH key, host key, user in the `docker` group). |
| Each sandbox call takes 10 s or more before the command starts | SSH connection reuse is off for the host (see [sandbox.md](sandbox.md#setting-up-a-host)). |
| `npm run db:generate` asks questions ("Interactive prompts require a TTY") | drizzle-kit can't tell a rename from a drop + add. Run it in a regular terminal and answer the prompt. |
| `npm install` fails with "Cannot read properties of null (reading 'edgesOut')" | An npm 10 bug while resolving peer dependencies. Add `--legacy-peer-deps` to that install. |
