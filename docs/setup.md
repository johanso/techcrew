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
| `TOKEN_ENCRYPTION_KEY` | for GitHub | `lib/crypto.ts` | 32 random bytes, base64. Encrypts GitHub access tokens at rest. Generate with `openssl rand -base64 32`. **Changing it makes every stored token unreadable**: users must reconnect GitHub. |
| `S3_ENDPOINT` | for logos | `lib/storage.ts` | S3 API endpoint, e.g. `https://s3.us-east-1.amazonaws.com`. Any S3-compatible service works. |
| `S3_REGION` | for logos | `lib/storage.ts` | Bucket region. |
| `S3_BUCKET` | for logos | `lib/storage.ts` | Bucket name. Keep it **private**; logos are served through the app. |
| `S3_ACCESS_KEY_ID` | for logos | `lib/storage.ts` | Access key with `s3:PutObject` and `s3:GetObject` on the bucket. |
| `S3_SECRET_ACCESS_KEY` | for logos | `lib/storage.ts` | Matching secret. |
| `OPENAI_API_KEY` | optional | `lib/openai.ts` | AI Team: **Draft with AI** and AI-assisted trust scans. Without it the page works with default instructions and rule-based scans. Calls use `gpt-6.1-sol` (`CONFIG_MODEL`) and their cost is charged to the agent's monthly budget. |
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

## 4. Create the database tables

```bash
npm run db:push
```

This compares `db/schema.ts` with the database and applies the difference (it creates `users`, `workspaces`,
`github_connections` and `tasks` on a fresh database). It prints the SQL before running it; read it. If a change
could lose data, drizzle-kit stops and asks for confirmation, which requires an interactive terminal.
More in [docs/data-model.md](data-model.md#schema-changes).

## 5. Run

```bash
npm run dev            # terminal 1 — http://localhost:3000
npm run inngest:dev    # terminal 2 — only needed for the board's Run action
```

## 6. First-run walkthrough

1. Open <http://localhost:3000> → **Get Started** (or `/sign-up`). Create an account.
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
- Apply schema changes with `npm run db:push` against the production database before deploying code that needs them.
- Read [docs/security.md](security.md#known-gaps) — in particular, remove or protect `POST /api/inngest/trigger`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `relation "workspaces" does not exist` (or any table) | Tables weren't created. Run `npm run db:push`. |
| "Connect GitHub" is disabled | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are not set. Restart the dev server after setting them. |
| GitHub redirects back with "We couldn't connect to GitHub" | Callback URL mismatch (must be exactly `<NEXT_PUBLIC_APP_URL>/api/github/callback`), wrong client secret, or missing `TOKEN_ENCRYPTION_KEY`. Check the server log for `[github] connect failed`. |
| A repository is missing from the picker | Only repositories you can **push** to and that aren't archived are listed (max 300). For org repos, the org may need to approve the OAuth App. |
| Board shows "Connect GitHub to bring … issues onto the board" | The workspace owner has no GitHub connection (or it was disconnected). Click **Connect GitHub**. |
| Board shows "Your GitHub connection expired or was revoked" | The token was revoked on GitHub (or `TOKEN_ENCRYPTION_KEY` changed). Click **Reconnect GitHub**. |
| **Run** fails with "Is the Inngest Dev Server running?" | Start `npm run inngest:dev`. Without it, the SDK falls back to Inngest Cloud and the placeholder event key is rejected (401). |
| Logo upload button is disabled | S3 variables are not set. |
| `npm run db:push` exits with "Interactive prompts require a TTY" | drizzle-kit wants to confirm a risky change (e.g. a new unique constraint on a non-empty table). Run it in a regular terminal and read the prompt; don't accept truncation unless you mean it. |
| `npm run lint` fails | There's no ESLint config yet. Use `npx tsc --noEmit` and `npm run build`. |
