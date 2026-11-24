# Setup

How to run TechTeam on your own computer, what each setting does, and how to move it to another computer. TechTeam is
one app for one user: you, signed in with your GitHub account. Nothing is hosted for you; the only remote services are
GitHub and the AI companies you choose.

- [What you need](#what-you-need)
- [Install and first run](#install-and-first-run)
- [Everyday commands](#everyday-commands)
- [Where your data lives](#where-your-data-lives)
- [Settings (environment variables)](#settings-environment-variables)
- [Signing in with GitHub](#signing-in-with-github)
- [Giving agents a model](#giving-agents-a-model)
- [Agent sandbox (optional)](#agent-sandbox-optional)
- [Moving to another computer](#moving-to-another-computer)
- [Coming from the hosted version](#coming-from-the-hosted-version)
- [Database](#database)
- [Troubleshooting](#troubleshooting)

---

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22.18 or newer | Runs Next.js 16 and the scripts (`engines` in `package.json`; the backup scripts import TypeScript, which Node strips from 22.18). |
| npm | bundled with Node | A `package-lock.json` is committed. |
| git | any | To clone the repository (and `start:local` uses it to know when to rebuild). |
| A GitHub account | | Signing in with it is also what gives agents access to your repositories. |
| Internet | | github.com, the AI companies, and the first run downloads the Inngest Dev Server (`npx`, pinned to 1.53.0). |

Optional: **Claude Code** with a Claude plan (agents work on your subscription), **API keys** for OpenAI, Anthropic or
OpenRouter, and **Docker** (on your computer, or a remote host) for the agent sandbox. You need at least one of the first two for agents to work.

## Install and first run

```bash
git clone <this repository's URL> techteam
cd techteam
npm install          # also downloads the embedded Postgres 18 for your system (about 110 MB)
cp .env.example .env # optional, but it sets the app's address, which agents on your Claude plan need
npm run doctor       # checks this computer and says how to fix what it finds
npm run dev          # database + app + Inngest Dev Server, one terminal
```

Open <http://localhost:3000>.

1. **Continue with GitHub** shows a code. **Open GitHub** opens github.com in a new tab: type the code there and
   authorize. The page signs you in by itself. (A personal access token with the `repo` scope works too, under "Use a
   personal access token instead".)
2. You land on **Create a new workspace** (you have none): name it, pick an icon or logo and a repository you can push
   to, then **Next**.
3. The **Overview** shows a **Get started** checklist until agents can work: add an AI route in **Settings → AI** (an
   API key, or your Claude plan) and create a workspace.
4. Open **Board**: the repository's open issues appear. Create a card with **New** (or use an issue) and press ▶ **Run**.
   The agents work card by card: Analyst, Developer, Reviewer and Security, Lead, Tester, merge. See
   [features.md](features.md#agent-pipeline).

The first start creates the database and applies the migrations by itself. Agents create real branches, commits and
pull requests on the linked repository: try it on a throwaway repository first. `AGENTS_SIMULATED=true` in `.env` runs
the whole pipeline with scripted agents (no model, no spend, but real GitHub work); see [testing.md](testing.md).

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development: the embedded database (unless `DATABASE_URL` is set), the app on <http://127.0.0.1:3000> and the Inngest Dev Server on <http://127.0.0.1:8288>, one terminal; stopping one stops all. `dev:app` = only the app. |
| `npm run start:local` | Stable mode for leaving agents working for hours: builds first when the code changed (or `-- --rebuild`), then runs the production build, the database and the Inngest Dev Server; Ctrl+C stops all three. |
| `npm run sandbox:setup` | Gets the two sandbox images onto this computer's Docker: downloads the sandbox image, builds the browser image from `deploy/browser`. Safe to run again, never removes anything. `-- --check` only reports; `-- --remote` prepares a remote host's images instead of refusing. [Sandbox](#agent-sandbox-optional). |
| `npm run doctor` | Checks Node, npm, git, tar, the data folder and disk, ports, database and migrations, app address, secrets, GitHub, Claude Code, Docker/WSL and obsolete `.env` settings; prints a fix for each problem. `-- --json` for scripts. Never prints a secret or a value from `.env`. Exits 1 only on a failure. |
| `npm run backup` / `npm run restore -- <file>` | One `.tar.gz` of your data, and its restore. [Moving to another computer](#moving-to-another-computer). |
| `npm run db:local` | Only the embedded database. `npm run dev` already starts it. |
| `npm run db:migrate` / `db:generate` / `db:studio` | Apply migrations / write one after changing `db/schema.ts` / browse the data. [data-model.md](data-model.md#schema-changes). |
| `npm run inngest:dev` | Only the Inngest Dev Server. |
| `npm run storage:import-s3` | One time, if your files are still in the old S3 bucket: [Coming from the hosted version](#coming-from-the-hosted-version). |
| `npm run skills:sync` | Maintainers: re-vendor the built-in agent skills. |
| `npm run check` / `npm test` / `npm run build` | Types, lint and unit tests / unit tests / production build. |

**After a `git pull`**: restart `npm run dev` (or `start:local`): the embedded database applies new migrations on start.
With your own database, run `npm run db:migrate`.

## Where your data lives

Everything is in one folder: `TECHTEAM_DATA_DIR`, by default `~/.techteam/data` (`C:\Users\<you>\.techteam\data` on
Windows).

| Path | What |
| --- | --- |
| `postgres/` | The embedded database's files. |
| `postgres.secret` | Its generated password. |
| `files/` | Workspace logos, the Tester's screenshots, card references (`workspace-logos/`, `card-references/`, ...). The database holds only relative keys. |
| `encryption.key` | Encrypts your GitHub token and AI keys at rest (AES-256-GCM). Generated on first use. |
| `session.secret` | Signs the session cookie. Deleting it signs you out. |

Claude Code's separate login for TechTeam lives in `~/.techteam/cli` (`TECHTEAM_CLI_HOME`). To start over, stop TechTeam
and delete the folder (everything is lost, including the secrets). Back up with `npm run backup`; the secret files are
**not** in the archive.

## Settings (environment variables)

Every setting is optional. Put the ones you want in `.env` (copy `.env.example`; `.env` is gitignored) and restart. There
are no secrets to put there: you sign in from the app, and your AI keys are saved in Settings → AI.

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | unset (`.env.example` sets `http://localhost:3000`) | The address you open TechTeam at. Used to accept the right `Host`, for cookies (`https` makes them `Secure`) and by agents on your Claude plan, which only exist when this is a local address. If you move the app's port with `TECHTEAM_PORT`, set it to match. |
| `TECHTEAM_DATA_DIR` | `~/.techteam/data` | The data folder above. |
| `DATABASE_URL` | unset = embedded Postgres | Your own Postgres connection string; nothing embedded starts. [Database](#database). |
| `TECHTEAM_PG_PORT` | `54329` | The embedded database's port (127.0.0.1 only). |
| `TECHTEAM_PORT`, `TECHTEAM_INNGEST_PORT` | `3000`, `8288` | Ports for `start:local` and `doctor`, to run a second copy beside one that is up. `npm run dev` always uses 3000 and 8288. |
| `GITHUB_CLIENT_ID` | the project's built-in OAuth App | Client id of your own GitHub OAuth App with Device Flow enabled. Public; there is no client secret. [Signing in](#signing-in-with-github). |
| `TOKEN_ENCRYPTION_KEY` | generated in `encryption.key` | 32 random bytes as base64 (`openssl rand -base64 32`). Overrides the file. Don't change or remove it once keys are saved: what the old key encrypted can't be read any more. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | unset | Fallback for a company you saved no key for in Settings → AI. |
| `AGENTS_SIMULATED` | `false` | `true`: scripted agents, no model calls, real GitHub work. For testing. |
| `AGENTS_LOCAL_CLI` | on | `false` turns agents-on-your-plan off on this computer. |
| `TECHTEAM_CLI_HOME`, `CLAUDE_CLI_PATH` | `~/.techteam/cli`, found automatically | Where TechTeam keeps Claude Code's login, and Claude Code's binary when it isn't in a known place. |
| `AGENTS_AUTO_PICKUP` | on | `false` keeps the auto-pickup cron off on this computer (only matters when computers share a database). |
| `SANDBOX_DOCKER_HOST`, `SANDBOX_IMAGE` | unset, `node:24-bookworm` | A remote Docker host for the agent sandbox (unset: this computer's Docker) and the sandbox image. [Sandbox](#agent-sandbox-optional), [sandbox.md](sandbox.md). |
| `SANDBOX_PREVIEW_DOMAIN`, `SANDBOX_BROWSER_IMAGE` | unset, `techteam-browser:1.64.1-4` | Remote hosts only: the wildcard domain for PR previews. The browser image's tag (`npm run sandbox:setup` builds it). |
| `TECHTEAM_SANDBOX` | on | `off` switches the agent sandbox off on this computer, local or remote. Not in `.env.example`. |

`INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` still switch the Inngest client to Cloud Mode, but a hosted setup isn't
supported; `doctor` lists them as obsolete. What happens when a setting is wrong or missing: `npm run doctor`.

## Signing in with GitHub

Sign-in is GitHub's **device flow**: no password, no sign-up, no callback URL and no client secret. One step identifies
you and gives agents access to your repositories (scopes `repo read:user`). The `repo` scope is broad (it covers every
repository of the account, private ones included); revoke it any time under GitHub → Settings → Applications.

The project's own OAuth App is built in (`DEFAULT_GITHUB_CLIENT_ID` in `lib/github-client-id.ts`). To use **your own**
(a fork): GitHub → Settings → Developer settings → OAuth Apps → New OAuth App; any homepage and callback URL (the form
asks, nothing uses them); open the app and tick **Enable Device Flow**; do not generate a client secret; put the client
id in `GITHUB_CLIENT_ID` and restart. For an organization's repositories the organization may need to approve the app.

## Giving agents a model

Settings → **AI**. Each agent picks its company and model on the AI Team page; a team can mix companies.

- **Claude plan (Claude Code).** Only on your computer. Install Claude Code's native build (Settings shows the command
  for your system; an npm-installed `claude.cmd` on Windows is refused). Settings → AI → **Plans on this computer** →
  **Sign in** (your personal Claude account; TechTeam keeps its own login in `~/.techteam/cli/claude`, apart from the one
  in your terminal) → **Check again** → **Confirm this account** → switch on **Use my Claude plan for Claude models**.
  Agents on Claude models then show **Your Claude plan** on the AI Team page. Details and plan limits:
  [cli-agents.md](cli-agents.md).
- **API keys.** Settings → AI → **API keys**: OpenAI, Anthropic and OpenRouter (one key for Google, DeepSeek, Z.ai, xAI
  and Moonshot models). Saved on your account, encrypted, checked with the company first, never shown again except
  masked. An Anthropic key is a Console API key; a Claude.ai subscription can't be used as a key.
- **Fallback order.** Settings → AI → **This workspace only**: the order companies are tried in when one runs out of
  credit, or when your Claude plan runs out and you chose **Switch company** (default: OpenAI, Anthropic, OpenRouter).
  **Switch automatically when out of credit** moves the agents by itself; without it the board offers a one-click
  switch and retry.
- **Models** come from OpenRouter's public list (no key), refreshed daily or with **Refresh models**.

## Agent sandbox (optional)

Without a sandbox, agents edit through the GitHub API and rely on your repository's CI for tests and builds. With one,
the Developer and the Tester run tests, the build and commands in throwaway containers, and the Tester can open a
preview of the pull request in a browser. Two ways to get one:

- **On this computer** (no `SANDBOX_DOCKER_HOST`): install Docker (Docker Desktop on Windows or macOS with **Linux
  containers**, or Docker Engine on Linux), start it, run `npm run sandbox:setup` once (downloads the sandbox image and
  builds the browser image; a few minutes and about 2 GB), then Settings → Sandbox → save the commands → **Test the
  sandbox**. Previews are served at `http://127.0.0.1:<port>`. Installs run without install scripts unless you tick
  **Allow install scripts**; there is no gVisor and no home-network firewall, so use a remote host for repositories you
  don't trust. What it protects and what not: [sandbox.md](sandbox.md#local-mode). `TECHTEAM_SANDBOX=off` switches it off.
- **On a remote Docker host**: a fresh Ubuntu 24.04 server prepared with `bash deploy/setup.sh` as root (then
  `--lock-ssh` once you can log in as `techteam` with a key). Set `SANDBOX_DOCKER_HOST` (for example
  `ssh://techteam@<ip>`), turn on SSH connection reuse for that host, restart, then the same Settings steps. gVisor,
  firewall rules and HTTPS previews on your own domain; link captures work only here. Details:
  [sandbox.md](sandbox.md#setting-up-a-remote-host).

## Moving to another computer

`npm run backup` writes **one** `.tar.gz`: every table as JSON lines (read from one consistent snapshot; the database is
only read), the stored files and a manifest. `npm run restore -- <file>` puts it into an **empty** database. Both need
the system `tar` (Windows 10+, macOS and Linux have it). **Secrets never travel**: the archive holds no GitHub token, AI
key or Claude plan setting.

On the old computer (the database must be running, `npm run dev` or `npm run db:local`):

```bash
npm run backup                   # or: npm run backup -- --out my-backup.tar.gz
```

Copy the `techteam-backup-<date>-<time>.tar.gz` to the new computer, install TechTeam there (previous sections), then:

```bash
npm run dev                      # the database must be running; leave it
npm run restore -- techteam-backup-<date>-<time>.tar.gz    # in a second terminal
```

Open the app, **Continue with GitHub** (the same account: it recognizes your user), and enter your AI keys again
(Settings → AI).

- Restore **never overwrites**: it refuses a database that already has a user or a workspace. With `DATABASE_URL`, run
  `npm run db:migrate` first. An archive from a **newer** TechTeam is refused (update first); an older one restores (new columns take their defaults; tables and columns
  that were dropped since, such as Switch Trust's, are skipped with a warning).
- All rows go in one transaction and the counts are checked against the manifest: any problem restores nothing. Files are
  copied first (identical files are skipped, different ones kept and reported), so running it again is safe.
- Runs that were queued or running when you backed up **won't continue** on the new computer. Backup warns about them
  (and needs `--yes` outside a terminal); after restoring, **Stop agents** on those cards and Run them again.
- The archive is treated as untrusted: only `manifest.json`, `tables/*.jsonl` and `files/**` are accepted, links and odd
  names are refused, and it is unpacked into a temporary folder in the data folder, never straight into place.
- Chat history of agent runs can be large. It is streamed, never loaded whole, but the archive and its temporary copy
  need free disk space.
- To keep your encrypted secrets too, copy `encryption.key` yourself (it is not in the archive): with it, the saved AI
  keys and GitHub token stay readable on the new computer.

## Coming from the hosted version

Earlier versions used a hosted Postgres and sign-in service, an S3 bucket, Cloudhike Jobs and Switch Trust. They are
gone: delete `AUTH_*`, `S3_*`, `JOBS_*`, `SWITCH_*`, `PUBLIC_APP_URL` and `GITHUB_CLIENT_SECRET` from your `.env`
(`npm run doctor` lists what it finds). To bring the old data over, on a computer that can still reach the old database and
bucket, install this version and run the backup once with the old settings in the environment for that one command only
(keep them out of the new setup's `.env`):

```bash
# bash; PowerShell: $env:DATABASE_URL="..." etc.
# S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_ENDPOINT) for --with-s3
DATABASE_URL=postgresql://... S3_BUCKET=... npm run backup -- --with-s3
```

`--with-s3` copies every object of the bucket (read only, nothing is deleted there) next to the local files. Then restore
it as above. If your database was already migrated to this version and only the files are missing, put the old `S3_*`
variables in `.env` and run `npm run storage:import-s3` instead: it copies every object under the same key into
`<data dir>/files`, skips files already there, never deletes from S3 and is safe to run again. The first sign-in on a
database with exactly one existing user asks whether to adopt that user's data with your GitHub account: answer
**Adopt** (run `npm run db:migrate` first on an existing database).

## Database

By default you need nothing: with `DATABASE_URL` unset, `npm run dev` (or `db:local`, or `start:local`) starts an
embedded Postgres 18 (the `embedded-postgres` package), creates the database on the first run and applies pending
migrations. It listens on `127.0.0.1:54329` (`TECHTEAM_PG_PORT`) with the generated password in `postgres.secret`.
`npm run db:migrate` and `db:studio` work against it while it runs. After a hard stop the next start removes the stale
lock by itself. No `pg_dump` is shipped: use `npm run backup`.

To use your own database, set `DATABASE_URL`; nothing embedded starts, and `npm run db:migrate` applies the migrations
(they are recorded in `drizzle.__drizzle_migrations`). A database created with `db:push` before migrations existed needs
`npm run db:baseline` once. More in [data-model.md](data-model.md#schema-changes).

## Troubleshooting

Start with `npm run doctor`: it names the problem and the fix.

| Symptom | Cause / fix |
| --- | --- |
| "The app port 3000 is already in use" (or 8288, 54329) | Another program, or another copy of TechTeam, owns the port. `npm run doctor` says by what. Stop it, or for `start:local` move yours with `TECHTEAM_PORT`, `TECHTEAM_INNGEST_PORT`, `TECHTEAM_PG_PORT`. `npm run dev` always wants 3000 and 8288. |
| `relation "workspaces" does not exist` (or any table) | The migrations haven't run. Restart `npm run dev` (embedded database) or run `npm run db:migrate`. |
| `npm run db:migrate` fails with `relation "..." already exists` | The database was created with `db:push`. Run `npm run db:baseline` once, then migrate again. |
| Settings → AI says "The saved key can't be read, probably because the encryption key changed" | `encryption.key` (or `TOKEN_ENCRYPTION_KEY`) is not the one that saved it, for example after restoring on another computer or deleting the data folder's key. The app keeps working: such a key counts as not set. Enter it again (saving replaces it), and sign in again if the GitHub connection is reported expired. |
| The board says "Your GitHub connection expired or was revoked" | The token was revoked on GitHub, or can't be read (see above). Click **Reconnect GitHub**: it signs you in again. |
| "Unknown host" (403) | You opened TechTeam under a name that isn't `localhost`, `127.0.0.1` or `[::1]`. Use one of those, or set `NEXT_PUBLIC_APP_URL` to that host. |
| Sign-in says Device Flow is switched off | Your own OAuth App needs **Enable Device Flow** ticked on GitHub. |
| A repository is missing from the picker | Only repositories you can **push** to and that aren't archived are listed (max 300). For organization repositories the organization may need to approve the OAuth App. |
| **Run** fails with "Is the Inngest Dev Server running?" | Start with `npm run dev` or `npm run start:local` (both start Inngest), or `npm run inngest:dev` if you ran `dev:app`. The first start downloads the pinned Dev Server with `npx`: it needs internet. |
| A run stays "running" after TechTeam stopped | Within about 35 minutes the sweeper ends it as "Interrupted when TechTeam stopped" and the bell says to press Run again, which continues the same branch. |
| No "Plans on this computer" in Settings | `NEXT_PUBLIC_APP_URL` isn't a local address (copy `.env.example` to `.env`), or `AGENTS_LOCAL_CLI=false`. |
| Settings → Sandbox is one line | It says why: Docker isn't installed, Docker Desktop isn't running (start it and reload), Docker is in Windows-containers mode (switch to Linux containers), or the images are missing (`npm run sandbox:setup`). `npm run doctor` shows the same. The answer is cached for 15 s. |
| **Test the sandbox** fails while preparing the checkout | Local: `docker info` in a terminal must work as the same user. Remote: try `docker -H "$SANDBOX_DOCKER_HOST" info` from the same computer (SSH key, host key, user in the `docker` group). |
| A package needs its install script and the sandbox's install passed without it | Local mode installs with `--ignore-scripts`. Tick **Allow install scripts** in Settings → Sandbox if you trust the repository ([sandbox.md](sandbox.md#local-mode)). |
| Each sandbox call takes 10 s or more before the command starts | SSH connection reuse is off for the remote host ([sandbox.md](sandbox.md#setting-up-a-remote-host)). |
| `npm run db:generate` asks questions ("Interactive prompts require a TTY") | drizzle-kit can't tell a rename from a drop + add. Run it in a regular terminal and answer. |
| `npm install` fails with "Cannot read properties of null (reading 'edgesOut')" | An npm 10 bug while resolving peer dependencies. Add `--legacy-peer-deps` to that install. |
