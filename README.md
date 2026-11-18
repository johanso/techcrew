# TechTeam

A workspace for running a software team made of AI agents. Each **workspace** is linked to exactly one
**GitHub repository**; its issues flow onto a **Kanban board**, and a team of AI agents (Analyst → Developer → Reviewer + Security → Lead → Tester) takes
cards from analysis to a merged pull request.

> The product name lives in one constant, `APP_NAME` in [`components/brand.tsx`](components/brand.tsx).
>
> **Current version: v0.4.0** (CI in the loop, Metrics page, a board that fits the screen). What's in it: [CHANGELOG.md](CHANGELOG.md). What comes next: [docs/roadmap.md](docs/roadmap.md).

---

## What works today

| Area | Status | Notes |
| --- | --- | --- |
| Sign up / sign in (email + password, GitHub, Google) | ✅ Real | Hosted Better Auth service (CloudHike). Sessions in an HTTP-only cookie. |
| Workspace onboarding | ✅ Real | Name, icon or uploaded logo, GitHub connection, repository selection. |
| Dashboard shell | ✅ Real | Collapsible sidebar, workspace switcher, user menu, light/dark/system theme. |
| Kanban board | ✅ Real | Six columns (Todo, Analysis, In Development, In Review, Testing, Done), drag and drop (mouse, touch, keyboard), search, type filters, create/edit dialog. Persisted in Postgres. |
| GitHub issue sync | ✅ Real | Open issues of the linked repo appear on the board automatically; Refresh button; closing an issue moves its card to Done. |
| Card actions | ✅ Real | **Run** (starts the agent pipeline), **Stop agents**, **View agent log** (what each agent did, stage by stage), **Remove task** (soft delete). |
| Agent pipeline | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (or `AGENTS_SIMULATED=true` to try it free) | Analyst plans → Developer commits on a branch and opens a PR → Reviewer and Security in parallel → Lead approves and rates the risk → Tester → merge (manual, automatic when low risk, or automatic). Rework loops, max turns per agent, permissions enforced as tools, skills searched and read with `search_skill` / `read_skill`, follow-up card on merge conflicts or failing builds. Auto pickup of Todo cards (optional). Out of credit: the board says so and switches company with one click (or automatically, opt-in). No code execution: verification is static plus CI. |
| Overview page | ✅ Real | Stats, upcoming tasks and recent activity from the board and the activity feed; empty states when there is nothing yet. |
| AI Team | ✅ Real | Six default agents (Analyst, Developer, Reviewer, Security, Lead, Tester), each with a face, per workspace: configure instructions, permissions, skills, model and budget; Trust Score with **Scan again**; spending; activity drawer. Each agent runs on an OpenAI or Claude model. AI drafts instructions and reviews configs (optional). |
| Switch Trust (SwitchAgent scans) | ✅ Real, verified live (needs a public URL) | Settings → Switch Trust connects a Switch account; every agent is registered there and each runs **one** Switch evaluation (on connect, every week, and on demand with **SwitchAgent Scan**); budgets become Switch cost caps. Runs in the background on Cloudhike jobs; health score, tests held and OWASP coverage update on their own. Needs a public URL (`PUBLIC_APP_URL`). See [docs/switch-trust.md](docs/switch-trust.md). |
| Live process | ✅ Real | AI Team page: each card in flight as six steps (who works, what they're doing, last actions, turns and cost so far, results of finished steps); "Inactive" when nothing runs. Agent cards show what a working agent is doing. |
| Pull Requests page | ✅ Real | Agent PRs with review/test verdicts and **Merge**. |
| Settings → Agent automation | ✅ Real | Task pickup and merge mode per workspace. |
| Agent skills | ✅ Real | Knowledge packs in the Agent Skills format that agents search and read (never run). Built-ins vendored at pinned commits (`modern-web-guidance`, `chrome-extensions`; `npm run skills:sync`); upload your own `SKILL.md` or `.zip` in **Settings → Agent skills** (validated, security-scanned, AI-reviewed when a key exists, then assigned per agent); switch them per agent in AI Team → Configure. |
| Settings → AI providers | ✅ Real | Encrypted OpenAI / Anthropic keys per workspace, provider switch, optional automatic switch when out of credit. |
| Activity page | ✅ Real | Workspace timeline (agent events + cards people created, moved, edited or removed), grouped by day. |
| Notifications (header bell) | ✅ Real | PR ready to merge, analyst questions, stopped runs, out of credit, provider switched, merges and blocked merges. |
| Landing page (`/`) | ➖ None yet | Redirects to the dashboard (signed in) or to sign-in. |

Details: [docs/status.md](docs/status.md).

---

## Quick start

```bash
npm install
cp .env.example .env          # then fill in the values — see docs/setup.md
npm run db:migrate            # create the tables in your Postgres database
npm run dev                   # http://localhost:3000
npm run inngest:dev           # in a second terminal — needed for the agent pipeline (Run, auto pickup)
```

You need: Node.js 22+, a PostgreSQL database, a CloudHike auth project, a GitHub OAuth App, and (optionally) an
S3 bucket for workspace logos, an OpenAI and/or Anthropic API key for the agents, AI drafting and AI-assisted trust scans,
and for SwitchAgent scans a Switch Trust key, a Cloudhike Jobs project and a public URL (a tunnel such as ngrok locally).
Step-by-step instructions: **[docs/setup.md](docs/setup.md)**.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) on port 3000. |
| `npm run build` | Production build. Must pass before merging. |
| `npm run start` | Serve the production build. |
| `npm run db:generate` | After changing `db/schema.ts`: write the SQL migration into `drizzle/` (review it, commit it). |
| `npm run db:migrate` | Apply pending migrations to the database. See [docs/data-model.md](docs/data-model.md#schema-changes). |
| `npm run db:baseline` | One time, for a database created with `db:push` before migrations existed: marks the migrations as applied. |
| `npm run db:push` | Prototyping only: push the schema without a migration. Don't use it on shared or production databases. |
| `npm run db:studio` | Drizzle Studio: browse and edit data in the browser. |
| `npm run inngest:dev` | Local Inngest Dev Server, pointed at `/api/inngest`. Required for the agent pipeline (**Run**, auto pickup, auto-merge). |
| `npm run lint` | ESLint (flat config: Next.js core web vitals + TypeScript). |
| `npm test` | Unit tests (Vitest). `npm run test:watch` while working. |
| `npm run check` | Route types (`next typegen`) + type check + lint + tests: run before every commit. CI runs it plus `npm run build` on every push and PR. |
| `npx next typegen` | Regenerate `PageProps` / `RouteContext` types after adding routes. |

---

## Documentation

| Guide | Read it to… |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Set up a local environment: every environment variable and external service. |
| [docs/architecture.md](docs/architecture.md) | Understand the stack, folder layout, request flow, auth and the server/client split. |
| [docs/data-model.md](docs/data-model.md) | Learn every table and column, constraints, and how schema changes are applied. |
| [docs/features.md](docs/features.md) | See how each feature behaves, screen by screen. |
| [docs/github-integration.md](docs/github-integration.md) | Understand the GitHub OAuth connection, repository linking and issue sync rules. |
| [docs/background-jobs.md](docs/background-jobs.md) | Work with Inngest: the agent job, local dev server, production keys. |
| [docs/switch-trust.md](docs/switch-trust.md) | Connect Switch Trust and run SwitchAgent scans (one evaluation per agent, in the background on Cloudhike jobs). |
| [docs/security.md](docs/security.md) | Know how sessions, authorization, secrets and uploads are protected — and the known gaps. |
| [docs/status.md](docs/status.md) | See what's real, dummy or placeholder, known limitations, and suggested next steps. |
| [docs/roadmap.md](docs/roadmap.md) | See where the product goes next (phases toward an AI software factory) and how a version is released. |
| [CHANGELOG.md](CHANGELOG.md) | See what each version added, what was verified live, and its known limitations. |
| [docs/testing.md](docs/testing.md) | Test the AI agents: simulated mode, providers and models, the test plan with what's verified, techniques and gotchas. |
| [AGENTS.md](AGENTS.md) | **Coding conventions and the design system** (colors, typography, components). Mandatory reading before changing code — for people and AI agents alike. |

---

## Tech stack (short)

Next.js 16 (App Router, React 19) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui on Base UI · Drizzle ORM +
PostgreSQL · hosted Better Auth (CloudHike) · GitHub OAuth App + REST API · AWS S3 · Inngest · dnd-kit · next-themes.
Full list and rationale in [docs/architecture.md](docs/architecture.md#stack).
