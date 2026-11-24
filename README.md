# TechTeam

An AI software team that works on your GitHub repository. You link **one repository per workspace**; its issues land on
a Kanban board, and a team of AI agents (Analyst, Developer, Reviewer, Security, Lead, Tester) takes each card from
analysis to a reviewed, tested, merged pull request. TechTeam runs **on your own computer**, for one user: your data
stays in a folder you own, and the only remote services are GitHub and the AI companies you choose.

> Version 0.9.0 (local-first) is the latest release. What changed: [CHANGELOG.md](CHANGELOG.md). What is real and what
> is not: [docs/status.md](docs/status.md).

## How it works

1. You sign in with GitHub, create a workspace and pick a repository you can push to.
2. Its open issues appear on the board; you can also create cards in the app.
3. Press **Run** on a card (or let auto pickup take Todo cards): the Analyst writes a brief, the Developer commits on an
   `agent/...` branch and opens a pull request.
4. CI runs on the pull request; Reviewer and Security look at the diff in parallel; the Lead approves or sends it back,
   and rates the risk.
5. The Tester checks it, then it merges by itself or waits for you, depending on the merge mode (default: you merge).
6. Agents run on your **Claude plan** (through Claude Code) and/or your **API keys** (OpenAI, Anthropic, OpenRouter), with a
   fallback order for when a plan or credit runs out. They never write to the default branch.

## Quickstart

You need **Node.js 22.18 or newer**, **git** and a **GitHub account**. For agents to work you also need a Claude plan
with [Claude Code](https://claude.com/claude-code) installed, or an API key for OpenAI, Anthropic or OpenRouter.
Docker is optional (agent sandbox, [docs/sandbox.md](docs/sandbox.md)).

```bash
git clone https://github.com/johanso/techcrew.git techteam
cd techteam
npm install            # also downloads an embedded Postgres 18 for your system (~110 MB)
cp .env.example .env   # optional; sets the app's address, which agents on your Claude plan need
npm run doctor         # checks this computer and says how to fix what it finds
npm run dev            # database, app and the Inngest Dev Server, one terminal
```

Then:

1. Open <http://localhost:3000> and choose **Continue with GitHub**. It shows a code: type it on github.com when asked.
2. Follow the **Get started** checklist: in **Settings → AI** add your Claude plan or an API key, and create a workspace
   (name, icon, repository).
3. On the **Board**, create a card (try a small one on a throwaway repository) and press ▶ **Run**.

Stop it with Ctrl+C. To leave agents working for hours, use `npm run start:local` instead (production build, clean
shutdown). Full guide, settings and troubleshooting: **[docs/setup.md](docs/setup.md)**.

## Where your data lives

In one folder, `~/.techteam/data` by default (`TECHTEAM_DATA_DIR` changes it): the embedded database, your files and the
secrets TechTeam generates (an encryption key, a session secret, the database password). Nothing needs configuring.
To move to another computer, run `npm run backup` on the old one and `npm run restore -- <file>` on the new one: one
`.tar.gz`, no secrets inside, so you sign in with GitHub and enter your AI keys again.
[docs/setup.md#moving-to-another-computer](docs/setup.md#moving-to-another-computer).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Embedded database + app on `127.0.0.1:3000` + Inngest Dev Server (`8288`), one terminal. `dev:app` = only the app; `inngest:dev` = only Inngest. |
| `npm run start:local` | Stable mode: builds when the code changed (`-- --rebuild` forces it), runs the production build, the database and Inngest, stops all on Ctrl+C. |
| `npm run doctor` | Checks Node, git, ports, database, secrets, GitHub, Claude Code and `.env`; `-- --json` for scripts. |
| `npm run backup` / `npm run restore -- <file>` | One archive of your database and files (no secrets), restored into an empty database. |
| `npm run db:local` | Only the embedded database (`npm run dev` starts it for you). |
| `npm run db:migrate` / `db:generate` / `db:studio` | Apply migrations / write one after editing `db/schema.ts` / browse the data. `db:baseline` and `db:push` are for old or throwaway databases. |
| `npm run storage:import-s3` | One time: copy files from the old S3 bucket of the hosted version. |
| `npm run skills:sync` | Maintainers: re-vendor the built-in agent skills at their pinned commits. |
| `npm run check` | Route types, `tsc`, ESLint and unit tests. Run before every commit; CI also runs the build. |
| `npm test` / `npm run lint` / `npm run build` | Unit tests (Vitest) / ESLint / production build. |

## Security in short

TechTeam listens on `127.0.0.1` only and refuses requests for any other host name. Your GitHub token and AI keys are
encrypted on disk; backups contain no secrets. Sign-in asks GitHub for the **`repo` scope**, which is broad (every
repository of the account, private ones included): it is what lets agents push branches, and you can revoke it any time
in GitHub's settings. Agents only write to their own branches, never to protected paths, and never merge on their own
unless you choose an automatic merge mode. More: [docs/security.md](docs/security.md).

## Project layout

`app/` routes and server actions, `components/` UI, `lib/` server logic (agents in `lib/agent-*.ts`, `lib/inngest/`,
`lib/sandbox/`, `lib/doctor/`, `lib/backup/`), `db/` schema, `drizzle/` migrations, `scripts/` the commands above,
`agent-skills/` vendored built-in skills, `deploy/` the optional sandbox host setup. Details:
[docs/architecture.md](docs/architecture.md) and [AGENTS.md](AGENTS.md).

## Documentation

| Guide | Read it to... |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Install, settings, data folder, Claude plan and API keys, moving computers, troubleshooting. |
| [docs/features.md](docs/features.md) | See how each feature behaves, screen by screen. |
| [docs/architecture.md](docs/architecture.md) | Understand the stack, folders, request flow, sign-in and the server/client split. |
| [docs/data-model.md](docs/data-model.md) | Every table and column, and how schema changes are applied. |
| [docs/github-integration.md](docs/github-integration.md) | The GitHub connection, repository linking and issue sync rules. |
| [docs/background-jobs.md](docs/background-jobs.md) | Inngest: the agent pipeline, auto pickup, the run sweeper, the pinned Dev Server. |
| [docs/cli-agents.md](docs/cli-agents.md) | Agents on your Claude plan through Claude Code: routes, isolation, plan limits. |
| [docs/sandbox.md](docs/sandbox.md) | The optional agent sandbox, previews and the Tester's browser. |
| [docs/security.md](docs/security.md) | How sessions, secrets and agents are protected, and the known gaps. |
| [docs/status.md](docs/status.md) | What is real, what is verified, known limitations. |
| [docs/testing.md](docs/testing.md) | Test the agents: simulated mode, the test plan and what is verified. |
| [docs/roadmap.md](docs/roadmap.md) | Where the product goes next, and how a version is released. |
| [docs/local-first-plan.md](docs/local-first-plan.md) | The local-first plan and the state of each phase. |
| [CHANGELOG.md](CHANGELOG.md) | What each version added. |
| [AGENTS.md](AGENTS.md) | **Coding conventions and the design system.** Mandatory reading before changing code, for people and AI agents. |

## Tech stack

Next.js 16 (App Router, React 19) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui on Base UI · Drizzle ORM +
PostgreSQL (embedded or your own) · GitHub device-flow sign-in · Inngest · dnd-kit · next-themes. Rationale in
[docs/architecture.md](docs/architecture.md#stack).
