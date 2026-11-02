# Project status

Where the project stands, what's not real yet, and what to tackle next. Last updated **2026-11-02**
(commit `15e1257`).

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
| Run (assign to Analyst + queue job) | ✅ Real assignment, 🟡 placeholder job | `runCardAction`, `lib/inngest/agent-run.ts` |
| Overview page | 🟡 Dummy data | `lib/overview.ts` |
| AI Team, Pull Requests, Activity pages | 🟡 Empty states | `app/dashboard/[workspaceId]/*` |
| Notifications (header bell) | 🟡 Empty state | `dashboard-header.tsx` |
| Settings page | 🟡 Read-only | `app/dashboard/[workspaceId]/settings` |
| Landing page `/` | 🟡 Starter-template marketing page | `app/page.tsx` |

## Dummy data and placeholders

Each is marked in code with `⚠️ DUMMY DATA` or `⚠️ PLACEHOLDER`:

- **`lib/overview.ts`** — the Overview's stats, upcoming tasks and recent activity are fixtures (timestamps relative
  to "now"). Replace the body of `getOverviewData` with queries over `tasks`; the UI reads only its return type.
- **`lib/agents.ts`** — the agent list (`atlas`, `nova`, `sage`, `orion`, `analyst`) is hard-coded. There's no agents
  table. `assignee_agent_id` stores these ids.
- **`lib/inngest/agent-run.ts`** — the `analyze` step only logs. This is where the agent runtime goes.
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
- **No agent runtime**: Run assigns and queues, nothing analyzes the task yet.
- **Workspace and account editing** isn't available (settings are read-only), nor deleting workspaces or accounts.
- **Run locally requires the Inngest Dev Server** (`npm run inngest:dev`).

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
2. **Agent runtime** for `agent-task-run`: read the card and the repo, write an analysis, report status on the card
   (queued → running → done/failed) instead of only the assignee.
3. **AI Team page** backed by an `agents` table (replacing `DUMMY_AGENTS`).
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
