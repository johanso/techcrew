# Project status

Where the project stands, what's not real yet, and what to tackle next. Last updated **2026-11-03**
(branch `feat/ai-agents`). For what has been tested and how to test the agents, see [testing.md](testing.md).

- [Feature status](#feature-status)
- [Dummy data and placeholders](#dummy-data-and-placeholders)
- [Known limitations](#known-limitations)
- [Technical debt](#technical-debt)
- [Suggested next steps](#suggested-next-steps)
- [History](#history)

---

## Feature status

| Feature | Status | Where |
| --- | --- | --- |
| Email/password sign-up and sign-in, email verification | ✅ Real | `app/(auth)` |
| GitHub and Google sign-in | ✅ Real | `app/api/auth/social`, `app/(auth)/auth/callback` |
| Workspace picker and creation (name, icon/logo, GitHub repo) | ✅ Real | `app/workspaces` |
| GitHub account connection (OAuth App, encrypted token) | ✅ Real | `app/api/github`, `lib/github.ts` |
| Logo upload to S3 | ✅ Real (needs S3 config) | `lib/storage.ts` |
| Dashboard shell: sidebar, switcher, header, user menu | ✅ Real | `components/dashboard` |
| Light / dark / system theme | ✅ Real | `app/layout.tsx`, `user-menu.tsx` |
| Kanban board: columns, create/edit, drag and drop, search, filters | ✅ Real, persisted | `components/board`, `lib/board.ts` |
| GitHub issue sync (auto + Refresh, close → Done) | ✅ Real | `lib/github-issues.ts` |
| Remove task (soft delete) | ✅ Real | `removeCardAction` |
| Agent pipeline: Run / Stop, Analyst → Developer → Reviewer → Tester → merge | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (untested against the live APIs; the Claude path is tested against a local fake of the API). `AGENTS_SIMULATED=true` runs it with scripted agents | `lib/agent-pipeline.ts`, `lib/inngest/agent-run.ts` |
| Auto pickup of Todo cards, auto or manual merge | ✅ Real | `lib/inngest/agent-pickup.ts`, `lib/pull-requests.ts` |
| Follow-up card from the Tester on merge conflict / failing build | ✅ Real | `lib/pull-requests.ts` |
| Overview page | 🟡 Dummy data | `lib/overview.ts` |
| AI Team: default agents, configure dialog, Skill Trust Score, spending, activity drawer | ✅ Real, persisted | `components/ai-team`, `lib/agents.ts` |
| AI drafting of instructions + AI-assisted trust scans | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | `lib/agent-ai.ts` |
| Pull Requests page (agent PRs, verdicts, Merge) | ✅ Real | `components/pull-requests`, `lib/pull-requests.ts` |
| Activity page | 🟡 Empty state | `app/dashboard/[workspaceId]/activity` |
| Notifications (header bell) | 🟡 Empty state | `dashboard-header.tsx` |
| Settings page | ✅ AI providers (encrypted keys, provider switch) and agent automation editable; account and workspace read-only | `app/dashboard/[workspaceId]/settings` |
| Landing page `/` | 🟡 Starter-template marketing page | `app/page.tsx` |

## Dummy data and placeholders

Each is marked in code with `⚠️ DUMMY DATA` or `⚠️ PLACEHOLDER`:

- **`lib/overview.ts`** — the Overview's stats, upcoming tasks and recent activity are fixtures (timestamps relative
  to "now"). Replace the body of `getOverviewData` with queries over `tasks`; the UI reads only its return type.
- **Some skills have no tool behind them**: Web research, Read environment secrets and Run tests in a sandbox are
  stored and scored but no agent tool exists for them (see [features.md](features.md#ai-team)).
- **AI Team office** — "Live Agent Office Workspace" is a placeholder (`AgentOfficePlaceholder`).
- **`lib/inngest/functions.ts` and `/api/inngest/trigger`** — examples from the starter template, unrelated to the
  product.
- **`app/page.tsx`** — landing page from the starter template (FastNextJS marketing copy, inline styles, its own
  colors outside the design system).

## Known limitations

- **Product name** is still "FastNextJS" in the UI (`APP_NAME` in `components/brand.tsx`, plus `app/layout.tsx`
  metadata and the auth layout footer).
- **Single owner per workspace**; no members, invitations or roles.
- **One repository per workspace**, fixed at creation; repository metadata (name, default branch, visibility) isn't
  refreshed after linking.
- **No webhooks**: issues arrive by polling (≤ 1 minute on an open board).
- **Sync imports at most 500 issues per run** and never writes back to GitHub.
- **Cards created in the app are not created on GitHub.**
- **No undo** for Remove task (the row is kept, but there's no UI to restore it).
- **Agents can't run code.** The Developer edits files through the GitHub API and the Tester verifies statically
  (diff, pre-checks, CI results). Builds and tests only run if the repository has CI on pull requests.
- **One commit per file edit** on agent branches (contents API); merges are squashed, so `main` gets one commit.
- **Reviews are posted as comments**, not approvals: GitHub doesn't let the token's own account approve its own PR.
- **Auto pickup only takes never-run cards**, one at a time per workspace, every 2 minutes.
- **Live board progress is polled** (every 10 s while a run is active), not pushed.
- **Workspace and account editing** isn't available (settings are read-only), nor deleting workspaces or accounts.
- **The agent pipeline locally requires the Inngest Dev Server** (`npm run inngest:dev`).
- **The agents have only run in simulated mode** (`AGENTS_SIMULATED=true`) and against a local fake of the Anthropic
  API; no run against the real OpenAI or Anthropic APIs yet. Simulated agents always take the happy path.
- **One AI company per workspace**: agents can't mix OpenAI and Anthropic models (by design; see features.md).
- **No automatic failover** between providers when one runs out of credit: the run fails with the provider's
  message; switch company in Settings and run again.
- **Agent branches are never deleted**, and closing an agent PR on GitHub ends its run as failed.

## Technical debt

| Item | Notes |
| --- | --- |
| No automated tests | Everything was verified manually and with throwaway scripts. Add unit tests for `lib/board.ts` validators, `typeFromLabels`/`priorityFromLabels`, `matchesQuery`, and integration tests for the sync. |
| No ESLint config | `npm run lint` fails. Add `eslint.config.mjs` with `eslint-config-next`. |
| `drizzle-kit push` instead of migrations | Fine for one developer and a dev database; move to `db:generate` + migrations before production. |
| Unused dependencies | `better-auth` is unused. `recharts`, `shiki`, `embla-carousel-react`, `cmdk`, `input-otp`, `react-day-picker`, `react-resizable-panels` are only used by shadcn components the app doesn't import (the app uses 19 of the 63 in `components/ui`). |
| Two `cn` helpers | shadcn components import `cn` from the `cn` npm package; app code uses `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`). Pick one. |
| Unauthenticated example route | `POST /api/inngest/trigger` — see [security.md](security.md#known-gaps). |
| `server-only` isn't installed as a package | Next.js handles it internally (optional per the Next docs), but scripts run outside Next (e.g. with `tsx`) can't import `server-only` modules without a shim. |
| Sequential updates in `reorderTasks` | One `UPDATE` per card in the moved columns. Fine at board sizes; batch it if columns grow large. |

## Suggested next steps

1. **Overview on real data** — counts per column, upcoming cards by due date, recent card/sync events.
2. **Try the pipeline with a real OpenAI or Anthropic key** on a test repository and tune the stage prompts and default
   max turns. Work through the open rows of the [test plan](testing.md#test-plan-and-status).
3. **Sandboxed execution** (container/VM) so the Developer and Tester can install, build and run tests before the PR.
4. **Activity log** table fed by board actions and syncs (powers Activity, Overview and notifications).
5. **GitHub webhooks** for real-time issues, and optional write-back (close the issue when a card reaches Done).
6. **Tests + ESLint + migrations**, then remove the starter-template leftovers (landing page, example jobs and
   route, unused dependencies) and rename the product.

## History

| Commit | Change |
| --- | --- |
| `8d05f34` | Auth (email + social), workspace onboarding with GitHub repo linking, theme tokens, AGENTS.md. |
| `7bcf7a6` | Dashboard shell with collapsible sidebar and workspace-scoped routes. |
| `2457df6` | Visual redesign: flat, tinted surfaces, Plus Jakarta Sans. |
| `b51f8f1` | Overview layout (dummy data). |
| `bff1cc4` | Persistent Kanban board with drag and drop, filters and card dialog. |
| `463701d` | GitHub issue sync; demo data removed. |
| `15e1257` | Card Run (Analyst + Inngest job) and Remove actions. |
| `d6f030e` | AI Team page: configurable agents, Skill Trust Score, spending, activity. |
| `feat/ai-agents` | Agent pipeline on the board (Analysis column, stages, PRs, merge, follow-ups, auto pickup), simulated agents, Anthropic as a second provider, provider keys and company switch in Settings, a model per agent per company, Merge / rerun on cards, testing guide. |
