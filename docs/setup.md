# Setup

Everything you need to run TechTeam locally, and what each setting does.

- [Prerequisites](#prerequisites)
- [1. Install](#1-install)
- [2. Environment variables](#2-environment-variables)
- [3. External services](#3-external-services)
- [4. Create the database tables](#4-create-the-database-tables)
- [5. Run](#5-run)
- [6. First-run walkthrough](#6-first-run-walkthrough)
- [Production notes](#production-notes)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 or newer | Runs Next.js 16; scripts use `node --env-file`. |
| npm | bundled with Node | Package manager (a `package-lock.json` is committed). |
| PostgreSQL | 14+ | App database. Any reachable instance works (local, Docker, hosted). |
| A CloudHike project | — | Hosted Better Auth service that handles sign-up, sign-in and social login. |
| A GitHub OAuth App | — | Lets users connect GitHub so a workspace can link a repository and sync its issues. |
| An S3-compatible bucket | optional | Stores uploaded workspace logos. Without it, logo upload is disabled (icons still work). |

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
| `NEXT_PUBLIC_APP_URL` | yes | OAuth redirects | Public origin of the app, e.g. `http://localhost:3000`. Used to build the GitHub and social-login callback URLs, so it must match what you register with those providers. |
| `DATABASE_URL` | yes | Drizzle (`db/index.ts`, `drizzle.config.ts`) | Postgres connection string. |
| `AUTH_URL` | yes | `lib/auth.ts` | Base URL of your CloudHike auth project, e.g. `https://cloudhike.dev/api/auth-service/<project-slug>`. |
| `AUTH_PUBLISHABLE_KEY` | yes | `lib/auth.ts` | Sent as `x-api-key` on every auth request. Starts with `pk_`. |
| `AUTH_SECRET_KEY` | no | — | Server-only key of the auth project. Not used by the current flows. |
| `GITHUB_CLIENT_ID` | for GitHub | `lib/github.ts` | Client ID of your GitHub OAuth App. |
| `GITHUB_CLIENT_SECRET` | for GitHub | `lib/github.ts` | Client secret of your GitHub OAuth App. |
| `TOKEN_ENCRYPTION_KEY` | for GitHub | `lib/crypto.ts` | 32 random bytes, base64. Encrypts GitHub access tokens and AI provider keys at rest. Generate with `openssl rand -base64 32`. **Changing it makes every stored token unreadable**: users must reconnect GitHub and re-enter AI keys. |
| `S3_ENDPOINT` | for logos | `lib/storage.ts` | S3 API endpoint, e.g. `https://s3.us-east-1.amazonaws.com`. Any S3-compatible service works. |
| `S3_REGION` | for logos | `lib/storage.ts` | Bucket region. |
| `S3_BUCKET` | for logos | `lib/storage.ts` | Bucket name. Keep it **private**; logos are served through the app. |
| `S3_ACCESS_KEY_ID` | for logos | `lib/storage.ts` | Access key with `s3:PutObject` and `s3:GetObject` on the bucket. |
| `S3_SECRET_ACCESS_KEY` | for logos | `lib/storage.ts` | Matching secret. |
| `OPENAI_API_KEY` | optional | `lib/ai-keys.ts` | Server-wide fallback; users normally save their own key once in Settings → Your account → AI keys. Agents on GPT models; **Draft with AI** and AI-assisted trust scans (on `gpt-6.1-sol`). Without any provider key the page works with default instructions and rule-based scans. Model cost is charged to the agent's monthly budget. |
| `ANTHROPIC_API_KEY` | optional | `lib/ai-keys.ts` | Server-wide fallback, as above. Agents on Claude models (Opus / Sonnet / Haiku 5.5). Also drafting and trust scans (on `claude-sonnet-5-5`) when `OPENAI_API_KEY` isn't set. A Console API key (pay as you go); a Claude.ai subscription can't be used. |
| `AGENTS_SIMULATED` | no | `lib/agent-simulated.ts` | Local testing. `true` runs the agent pipeline with scripted agents: no model calls and no spend, but real GitHub work on the linked repo (a branch, one note file `agent-simulations/<branch>.md`, a pull request). Each turn waits 4 s so you can watch the card move. Leave `false` in production. |
| `JOBS_API_URL`, `JOBS_API_KEY` | for Switch scans | `lib/jobs.ts` | Cloudhike Jobs project (`https://cloudhike.dev/api/jobs-service/<project>`) and its server-only key. SwitchAgent scans run on it. |
| `PUBLIC_APP_URL` | for Switch scans | `lib/jobs.ts` | The app's internet-reachable origin, called back by Cloudhike jobs and Switch evaluations. Defaults to `NEXT_PUBLIC_APP_URL`; a local address disables scans, so in dev use a tunnel (`ngrok http 3000`). |
| `SWITCH_AGENT_AI_API_KEY` | optional | `lib/switch-trust.ts` | Server-wide Switch Trust key (Editor role) for workspaces that connect without their own. See [switch-trust.md](switch-trust.md). |
| `SANDBOX_DOCKER_HOST` | for the sandbox | `lib/sandbox/docker.ts` | Docker host for agent sandboxes: `ssh://<user>@<ip>` (or an `~/.ssh/config` alias) for a VPS set up with `deploy/setup.sh`, `unix:///var/run/docker.sock` when the app runs on it. Unset: Settings → Sandbox can't be switched on. See [sandbox.md](sandbox.md). |
| `SANDBOX_IMAGE` | no | `lib/sandbox/docker.ts` | Container image for sandboxes. Default `node:24-bookworm`. |
| `INNGEST_EVENT_KEY` | production | `lib/inngest/client.ts` | Inngest Cloud event key. Not needed locally (the Dev Server is used). |
| `INNGEST_SIGNING_KEY` | production | Inngest `serve()` | Verifies requests from Inngest Cloud to `/api/inngest`. Not needed locally. |
| `INNGEST_DEV` | no | Inngest SDK | Set to `1` to force Dev Mode, `0` to force Cloud Mode. If unset, the SDK (v3) infers Dev Mode unless the environment looks like production (`NODE_ENV=production`, Vercel/Netlify production, …). |

What happens when an optional group is missing:

- **GitHub variables missing** → the "Connect GitHub" button on the create-workspace page is disabled and shows
  "GitHub integration isn't configured on this server yet." You can't create a workspace (a repository is required).
- **`TOKEN_ENCRYPTION_KEY` missing or wrong length** → connecting GitHub fails with an error in the server log.
- **S3 variables missing** → the "Upload custom logo" button is disabled with an explanation; icons still work.
- **Inngest Dev Server not running (locally)** → the board's **Run** action fails with
  "Is the Inngest Dev Server running? Start it with `npm run inngest:dev`." Nothing else is affected.

## 3. External services

### PostgreSQL

Any Postgres you can reach. Examples:

```bash
# Docker
docker run -d --name techteam-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
```

The hosted auth service keeps its own data in an `auth` schema of the **same** database when you use CloudHike's
managed database; `drizzle.config.ts` restricts Drizzle to the `public` schema (`schemaFilter: ['public']`) so it
never touches it.

### CloudHike auth (hosted Better Auth)

1. Create a project at [cloudhike.dev](https://cloudhike.dev) and copy its **auth URL** and **publishable key**
   into `AUTH_URL` and `AUTH_PUBLISHABLE_KEY`.
2. Enable the providers you want (email/password, GitHub, Google) in the project settings.
3. Allow `<NEXT_PUBLIC_APP_URL>/auth/callback` as a redirect target for social sign-in.
4. If "require email verification" is on, sign-up shows "Check your inbox" instead of signing the user in.

> Sign-in with GitHub (identity) and **Connect GitHub** (repository access) are separate. The hosted service never
> exposes provider tokens, so repository access uses the project's own GitHub OAuth App (next section).

### GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (<https://github.com/settings/developers>).
2. **Homepage URL**: your `NEXT_PUBLIC_APP_URL`.
3. **Authorization callback URL**: `<NEXT_PUBLIC_APP_URL>/api/github/callback`
   (locally: `http://localhost:3000/api/github/callback`).
4. Create it, then **Generate a new client secret**.
5. Put the values in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, and generate `TOKEN_ENCRYPTION_KEY`.

The app requests the `repo` and `read:user` scopes. For organization repositories, an org owner may need to
approve the OAuth App (GitHub → Organization settings → Third-party access) before its repos appear.

### S3 bucket (optional)

Create a private bucket (block all public access) and an access key limited to that bucket. Logos are stored
under `workspace-logos/<ownerId>/<uuid>.<ext>` and streamed to their owner by `/api/workspaces/[id]/logo`.

### Inngest

Locally nothing to configure: run `npm run inngest:dev`. It starts the Inngest Dev Server (UI on
<http://localhost:8288>) and points it at `http://localhost:3000/api/inngest`, where the app's functions are
served. For production see [docs/background-jobs.md](background-jobs.md#production).

### Switch Trust and Cloudhike Jobs (optional)

For SwitchAgent scans: create a Jobs project on Cloudhike (`JOBS_API_URL`, `JOBS_API_KEY`), an API key with the
Editor role in Switch Trust (Settings → API keys), and expose the app publicly (`PUBLIC_APP_URL`). Then Settings →
Switch Trust → **Connect securely**. Details: [switch-trust.md](switch-trust.md).

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
npm run dev            # terminal 1 — http://localhost:3000
npm run inngest:dev    # terminal 2 — only needed for the board's Run action
```

## 6. First-run walkthrough

1. Open <http://localhost:3000> (it redirects to sign-in) → **Sign up**. Create an account.
2. You land on `/workspaces`, which forwards you to **Create a new workspace** because you have none.
3. Name it, pick an icon (or upload a logo), click **Connect GitHub**, authorize, and pick a repository you can
   push to. Click **Next**.
4. You're on the workspace **Overview**. Open **Board** in the sidebar: it syncs the repository's open issues
   immediately ("Syncing with GitHub…").
5. Create a card with **New**, drag cards between columns, click a card to edit it, or press ▶ to run it.

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
| "Connect GitHub" is disabled | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are not set. Restart the dev server after setting them. |
| GitHub redirects back with "We couldn't connect to GitHub" | Callback URL mismatch (must be exactly `<NEXT_PUBLIC_APP_URL>/api/github/callback`), wrong client secret, or missing `TOKEN_ENCRYPTION_KEY`. Check the server log for `[github] connect failed`. |
| A repository is missing from the picker | Only repositories you can **push** to and that aren't archived are listed (max 300). For org repos, the org may need to approve the OAuth App. |
| Board shows "Connect GitHub to bring … issues onto the board" | The workspace owner has no GitHub connection (or it was disconnected). Click **Connect GitHub**. |
| Board shows "Your GitHub connection expired or was revoked" | The token was revoked on GitHub (or `TOKEN_ENCRYPTION_KEY` changed). Click **Reconnect GitHub**. |
| **Run** fails with "Is the Inngest Dev Server running?" | Start `npm run inngest:dev`. Without it, the SDK falls back to Inngest Cloud and the placeholder event key is rejected (401). |
| Logo upload button is disabled | S3 variables are not set. |
| Settings → Sandbox can't be switched on | `SANDBOX_DOCKER_HOST` isn't set (restart the dev server after setting it), or neither a test nor a build command is saved. |
| **Test the sandbox** fails while preparing the checkout | The app can't reach Docker on the host: try `docker -H "$SANDBOX_DOCKER_HOST" info` from the same machine (SSH key, host key, user in the `docker` group). |
| Each sandbox call takes 10 s or more before the command starts | SSH connection reuse is off for the host (see [sandbox.md](sandbox.md#setting-up-a-host)). |
| `npm run db:generate` asks questions ("Interactive prompts require a TTY") | drizzle-kit can't tell a rename from a drop + add. Run it in a regular terminal and answer the prompt. |
| `npm install` fails with "Cannot read properties of null (reading 'edgesOut')" | An npm 10 bug while resolving peer dependencies. Add `--legacy-peer-deps` to that install. |
