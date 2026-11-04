# TechTeam

A workspace for running a software team made of AI agents. Each **workspace** is linked to exactly one
**GitHub repository**; its issues flow onto a **Kanban board**, and a team of AI agents (Analyst → Developer → Reviewer → Tester) takes
cards from analysis to a merged pull request.

> The product is still branded **FastNextJS** in the UI (the name of the boilerplate it started from). The name
> lives in one constant, `APP_NAME` in [`components/brand.tsx`](components/brand.tsx).

---

## What works today

| Area | Status | Notes |
| --- | --- | --- |
| Sign up / sign in (email + password, GitHub, Google) | ✅ Real | Hosted Better Auth service (CloudHike). Sessions in an HTTP-only cookie. |
| Workspace onboarding | ✅ Real | Name, icon or uploaded logo, GitHub connection, repository selection. |
| Dashboard shell | ✅ Real | Collapsible sidebar, workspace switcher, user menu, light/dark/system theme. |
| Kanban board | ✅ Real | Six columns (Todo, Analysis, In Development, In Review, Testing, Done), drag and drop (mouse, touch, keyboard), search, type filters, create/edit dialog. Persisted in Postgres. |
| GitHub issue sync | ✅ Real | Open issues of the linked repo appear on the board automatically; Refresh button; closing an issue moves its card to Done. |
| Card actions | ✅ Real | **Run** (starts the agent pipeline), **Stop agents**, **Remove task** (soft delete). |
| Agent pipeline | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (or `AGENTS_SIMULATED=true` to try it free) | Analyst plans → Developer commits on a branch and opens a PR → Reviewer → Tester → merge (manual or automatic). Rework loops, max turns per agent, skills enforced as tools, follow-up card on merge conflicts or failing builds. Auto pickup of Todo cards (optional). No code execution: verification is static plus CI. |
| Overview page | ✅ Real | Stats, upcoming tasks and recent activity from the board and the activity feed; empty states when there is nothing yet. |
| AI Team | ✅ Real | Four default agents (Analyst, Developer, Reviewer, Tester) per workspace: configure instructions, skills, model and budget; Skill Trust Score with **Scan again**; spending; activity drawer. Each agent runs on an OpenAI or Claude model. AI drafts instructions and reviews configs (optional). |
| Live Agent Office | ✅ Real | AI Team page: the agents at their desks in an illustrated office, typing while they work, with live status bubbles and hover cards (`npm run office:assets` builds the sprites). |
| Pull Requests page | ✅ Real | Agent PRs with review/test verdicts and **Merge**. |
| Settings → Agent automation | ✅ Real | Task pickup and merge mode per workspace. |
| Activity page | ✅ Real | Workspace timeline (agent events + cards people created), grouped by day. |
| Landing page (`/`) | 🟡 Boilerplate | Marketing page from the starter template. |

Details: [docs/status.md](docs/status.md).

---

## Quick start

```bash
npm install
cp .env.example .env          # then fill in the values — see docs/setup.md
npm run db:push               # create/update tables in your Postgres database
npm run dev                   # http://localhost:3000
npm run inngest:dev           # in a second terminal — needed for the agent pipeline (Run, auto pickup)
```

You need: Node.js 22+, a PostgreSQL database, a CloudHike auth project, a GitHub OAuth App, and (optionally) an
S3 bucket for workspace logos and an OpenAI and/or Anthropic API key for the agents, AI drafting and AI-assisted trust scans. Step-by-step instructions: **[docs/setup.md](docs/setup.md)**.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) on port 3000. |
| `npm run build` | Production build. Must pass before merging. |
| `npm run start` | Serve the production build. |
| `npm run db:push` | Apply `db/schema.ts` to the database (no migration files — see [docs/data-model.md](docs/data-model.md#schema-changes)). |
| `npm run db:studio` | Drizzle Studio: browse and edit data in the browser. |
| `npm run db:generate` | Generate SQL migration files into `drizzle/` (not used so far). |
| `npm run inngest:dev` | Local Inngest Dev Server, pointed at `/api/inngest`. Required for the agent pipeline (**Run**, auto pickup, auto-merge). |
| `npx tsc --noEmit` | Type check. |
| `npx next typegen` | Regenerate `PageProps` / `RouteContext` types after adding routes. |

`npm run lint` exists but the project has **no ESLint config yet**, so it doesn't run.

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
| [docs/security.md](docs/security.md) | Know how sessions, authorization, secrets and uploads are protected — and the known gaps. |
| [docs/status.md](docs/status.md) | See what's real, dummy or placeholder, known limitations, and suggested next steps. |
| [docs/testing.md](docs/testing.md) | Test the AI agents: simulated mode, providers and models, the test plan with what's verified, techniques and gotchas. |
| [AGENTS.md](AGENTS.md) | **Coding conventions and the design system** (colors, typography, components). Mandatory reading before changing code — for people and AI agents alike. |

---

## Tech stack (short)

Next.js 16 (App Router, React 19) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui on Base UI · Drizzle ORM +
PostgreSQL · hosted Better Auth (CloudHike) · GitHub OAuth App + REST API · AWS S3 · Inngest · dnd-kit · next-themes.
Full list and rationale in [docs/architecture.md](docs/architecture.md#stack).
