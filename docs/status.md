# Project status

Where the project stands, what's not real yet, and what to tackle next. Last updated **2026-11-04**
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
| Answer the analyst's question from the card, its menu or the agent log (answer kept for later runs) | ✅ Real, verified with OpenAI | `components/board/answer-dialog.tsx`, `answerCardAction`, `agent_runs.answer` |
| Agent log per card (tool calls, files changed, how each stage ended, cost) | ✅ Real (from runs started after it shipped) | `components/board/run-log-sheet.tsx`, `agent_run_steps` |
| Out of credit: board notice, switch company and retry, optional automatic switch | ✅ Real (automatic switch not run end to end) | `components/board/credit-notice.tsx`, `lib/agent-pipeline.ts` |
| Agent pipeline: Run / Stop, Analyst → Developer → Reviewer → Tester → merge | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (verified live with OpenAI on 2026-11-05; the Claude path only against a local fake of the API). `AGENTS_SIMULATED=true` runs it with scripted agents | `lib/agent-pipeline.ts`, `lib/inngest/agent-run.ts` |
| Auto pickup of Todo cards, auto or manual merge | ✅ Real | `lib/inngest/agent-pickup.ts`, `lib/pull-requests.ts` |
| Follow-up card from the Tester on merge conflict / failing build | ✅ Real | `lib/pull-requests.ts` |
| Overview page (stats, upcoming tasks, recent activity) | ✅ Real, from the board and the activity feed | `lib/overview.ts`, `lib/activity.ts` |
| AI Team: default agents, configure dialog, Skill Trust Score, spending, activity drawer | ✅ Real, persisted | `components/ai-team`, `lib/agents.ts` |
| Live Agent Office (AI Team page): agents at desks, typing while working, status bubbles, hover cards, live polling | ✅ Real | `components/office`, `lib/office-scene.json` |
| AI drafting of instructions + AI-assisted trust scans | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | `lib/agent-ai.ts` |
| Switch Trust: connect a Switch account, SwitchAgent scans (register agents, one evaluation each, health score + OWASP coverage) in the background via Cloudhike jobs | 🟡 Built and unit-tested; the agent endpoint verified with a real OpenAI call; never run against a real Switch instance (needs a public URL) | `lib/switch-trust.ts`, `docs/switch-trust.md` |
| Pull Requests page (agent PRs, verdicts, Merge) | ✅ Real | `components/pull-requests`, `lib/pull-requests.ts` |
| Activity page (workspace timeline, incl. people's card moves, edits and removals) | ✅ Real | `lib/activity.ts`, `components/activity` |
| Notifications (header bell): PR ready, merged, merge blocked, needs info, run stopped, out of credit, provider switched | ✅ Real (polled every 30 s) | `lib/notifications.ts`, `components/dashboard/notifications-menu.tsx` |
| Settings page | ✅ AI providers (encrypted keys, provider switch) and agent automation editable; account and workspace read-only | `app/dashboard/[workspaceId]/settings` |
| Landing page `/` | ➖ None: redirects to the dashboard or sign-in | `app/page.tsx` |

## Dummy data and placeholders

Each is marked in code with `⚠️ DUMMY DATA` or `⚠️ PLACEHOLDER`:

- **Some skills have no tool behind them**: Web research, Read environment secrets and Run tests in a sandbox are
  stored and scored but no agent tool exists for them (see [features.md](features.md#ai-team)).

## Known limitations

- **No public landing page**: `/` redirects (the starter's marketing page was removed).
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
- **Live board progress is polled** (every 10 s while a run is active, database only), not pushed.
- **Workspace and account editing** isn't available (settings are read-only), nor deleting workspaces or accounts.
- **The agent pipeline locally requires the Inngest Dev Server** (`npm run inngest:dev`).
- **The agents have only run in simulated mode** (`AGENTS_SIMULATED=true`) and against a local fake of the Anthropic
  API; no run against the real OpenAI or Anthropic APIs yet. Simulated agents always take the happy path.
- **One AI company per workspace**: agents can't mix OpenAI and Anthropic models (by design; see features.md).
- **Out of credit** stops the run with a notice and a one-click "switch and retry". The automatic switch is opt-in
  (Settings → AI providers), restarts the current stage once, and has only been verified by unit tests (detection),
  not against a real provider running dry.
- **The agent log only covers runs started after it shipped**; older runs show "Nothing logged".
- **Notifications are polled** (30 s), not pushed, and only go to the workspace owner. There's no email.
- **Agent branches are never deleted**, and closing an agent PR on GitHub ends its run as failed.

## Technical debt

| Item | Notes |
| --- | --- |
| Unit tests only | 33 Vitest tests for pure logic (filters, model mapping, trust scan, costs, credit detection, log steps, office scene). No integration tests for the database, the sync or the pipeline yet. |
| Two `cn` helpers | shadcn components import `cn` from the `cn` npm package; app code uses `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`). Pick one. |
| `server-only` isn't installed as a package | Next.js handles it internally (optional per the Next docs), but scripts run outside Next (e.g. with `tsx`) can't import `server-only` modules without a shim. |
| Sequential updates in `reorderTasks` | One `UPDATE` per card in the moved columns. Fine at board sizes; batch it if columns grow large. |

## Suggested next steps

1. **Try the pipeline with a real OpenAI or Anthropic key** on a test repository and tune the stage prompts and default
   max turns. Work through the open rows of the [test plan](testing.md#test-plan-and-status).
2. **Sandboxed execution** (container/VM) so the Developer and Tester can install, build and run tests before the PR.
3. **Switch AI integration** (switchagents.ai): Trust evaluations, weekly scans and cost caps are in
   ([switch-trust.md](switch-trust.md)); first live scan pending. Next: ROI usage tracking (SDK), runtime guardrails, Rooms.
4. **GitHub webhooks** for real-time issues, and optional write-back (close the issue when a card reaches Done).
5. **Integration tests** (database + pipeline in simulated mode). CI (`.github/workflows/ci.yml`) runs check + build.
6. **Email notifications**, and GitHub syncs on the Activity page.

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
| `feat/ai-agents` (6) | Switch: verified end to end against local fakes, weekly scans (Inngest cron + toggle), monthly budgets as Switch cost caps. People's card moves, edits and removals on Activity (`task_events`). CI workflow; `npm run check` runs `next typegen` first so a fresh clone type-checks. |
| `feat/ai-agents` (5) | Switch Trust: connect a Switch account in Settings, SwitchAgent scans (agents registered in Switch, one evaluation each, health score + OWASP coverage) on connect and on demand, run in the background on Cloudhike jobs; OpenAI-compatible endpoint per agent for Switch's tests. |
| `feat/ai-agents` (4) | Answer the analyst from the board, converging reviews, session cache and lighter board polling, accent-free branch names. |
| `feat/ai-agents` (3) | Out-of-credit notice with switch-and-retry and opt-in automatic switch, agent log per card, notifications bell, model picker fix, header shows the repo name, sidebar account menu removed. Production prep: ESLint, Vitest (33 tests), Drizzle migrations (baseline), renamed to TechTeam, starter leftovers and 40 unused shadcn components + 9 dependencies removed. |
| `feat/ai-agents` (2) | Overview and Activity on real data (no fixtures left, empty states), AI team card, cost per step on Activity, Live Agent Office on the AI Team page (sprites from the office editor's scene bundle, live status polling). |
| `feat/ai-agents` | Agent pipeline on the board (Analysis column, stages, PRs, merge, follow-ups, auto pickup), simulated agents, Anthropic as a second provider, provider keys and company switch in Settings, a model per agent per company, Merge / rerun on cards, testing guide. |
