# Project status

Where the project stands, what's not real yet, and what to tackle next. Last updated **2026-11-17**
(release **v0.3.0**, on `main`). For what has been tested and how to test the agents, see [testing.md](testing.md).

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
| Agent pipeline: Run / Stop, Analyst → Developer → Reviewer + Security (parallel) → Lead (approval + risk) → Tester → merge | ✅ Real (the v0.2 Security/Lead stages verified in simulated mode only), needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (verified live with OpenAI on 2026-11-05; the Claude path only against a local fake of the API). `AGENTS_SIMULATED=true` runs it with scripted agents | `lib/agent-pipeline.ts`, `lib/inngest/agent-run.ts` |
| Auto pickup of Todo cards; manual, automatic-when-low-risk or automatic merge | ✅ Real | `lib/inngest/agent-pickup.ts`, `lib/agent-run-config.ts` (`mergeDecision`), `lib/pull-requests.ts` |
| Follow-up card from the Tester on merge conflict / failing build | ✅ Real | `lib/pull-requests.ts` |
| Overview page (stats, upcoming tasks, recent activity) | ✅ Real, from the board and the activity feed | `lib/overview.ts`, `lib/activity.ts` |
| AI Team: six default agents with faces, configure dialog (permissions, skills), Trust Score, spending, activity drawer, live working state | ✅ Real, persisted | `components/ai-team`, `lib/agents.ts`, `public/agents` |
| Agent skills: built-ins vendored by `npm run skills:sync` (modern-web-guidance, chrome-extensions), uploads with validation + security scan + AI review, per-agent switches, `search_skill` / `read_skill` in every stage, always-loaded playbooks in the prompt, findings in the trust score | ✅ Real (server verified against the dev database with one real AI review; UI rendered with real data but not clicked through; a simulated run with skills not run end to end) | `agent-skills/`, `lib/agent-skills.ts`, `lib/skill-*.ts`, `components/skills`, `/settings/skills` |
| Live process (AI Team page): the six steps of each card in flight, live polling | ✅ Real | `components/ai-team/live-process.tsx`, `lib/live-process.ts` |
| AI drafting of instructions + AI-assisted trust scans | ✅ Real, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | `lib/agent-ai.ts` |
| Switch Trust: connect a Switch account, SwitchAgent scans (register agents, one evaluation each, health score + OWASP coverage) in the background via Cloudhike jobs | ✅ Live scan verified with Switch (2026-11-16, through ngrok); weekly scans and cost caps verified against local fakes | `lib/switch-trust.ts`, `docs/switch-trust.md` |
| Pull Requests page (agent PRs, approval and test verdicts, risk, Merge) | ✅ Real | `components/pull-requests`, `lib/pull-requests.ts` |
| Activity page (workspace timeline, incl. people's card moves, edits and removals) | ✅ Real | `lib/activity.ts`, `components/activity` |
| Notifications (header bell): PR ready, merged, merge blocked, needs info, run stopped, out of credit, provider switched | ✅ Real (polled every 30 s) | `lib/notifications.ts`, `components/dashboard/notifications-menu.tsx` |
| Settings page | ✅ AI providers (encrypted keys, provider switch), agent automation and agent skills editable; account and workspace read-only | `app/dashboard/[workspaceId]/settings` |
| Landing page `/` | ➖ None: redirects to the dashboard or sign-in | `app/page.tsx` |

## Dummy data and placeholders

Each is marked in code with `⚠️ DUMMY DATA` or `⚠️ PLACEHOLDER`:

- **Some permissions have no tool behind them**: Web research, Read environment secrets and Run tests in a sandbox are
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
- **Live runs so far are on OpenAI** (GPT-6.1 Sol / GPT-6 Luna); the Anthropic path is verified only against a local
  fake of its API. Simulated agents always take the happy path.
- **Switch scans need a public URL** (not deployed yet: a tunnel such as ngrok), for both Switch's tests and the
  Cloudhike jobs. Weekly scans fail while it's unreachable.
- **One AI company per workspace**: agents can't mix OpenAI and Anthropic models (by design; see features.md).
- **Out of credit** stops the run with a notice and a one-click "switch and retry". The automatic switch is opt-in
  (Settings → AI providers), restarts the current stage once, and has only been verified by unit tests (detection),
  not against a real provider running dry.
- **The agent log only covers runs started after it shipped**; older runs show "Nothing logged".
- **Agent skills are knowledge only**: agents search and read them; skills can't add tools or run anything. Search is
  keyword ranking over titles, paths and summaries (no embeddings). Skills from the linked repository aren't read yet.
- **Notifications are polled** (30 s), not pushed, and only go to the workspace owner. There's no email.
- **Agent branches are never deleted**, and closing an agent PR on GitHub ends its run as failed.

## Technical debt

| Item | Notes |
| --- | --- |
| Unit tests only | 129 Vitest tests for pure logic (filters, model mapping, roles, trust scan, costs, credit detection, tools per stage, log steps, phases and working agents, risk floor and merge decision, live process, Switch mapping, card-change descriptions, skill frontmatter/zip/scan/search/prompt), run by CI on every push. No integration tests for the database, the sync or the pipeline yet. |
| Two `cn` helpers | shadcn components import `cn` from the `cn` npm package; app code uses `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`). Pick one. |
| `server-only` isn't installed as a package | Next.js handles it internally (optional per the Next docs), but scripts run outside Next (e.g. with `tsx`) can't import `server-only` modules without a shim. |
| Sequential updates in `reorderTasks` | One `UPDATE` per card in the moved columns. Fine at board sizes; batch it if columns grow large. |

## Suggested next steps

The plan lives in [roadmap.md](roadmap.md): smarter gates and the live process are done (v0.2), and so are agent skills (v0.3);
next are deploy and hardening, including mixed model companies per agent (v0.4), a sandbox to run code (v0.5), and a
shared project memory (v0.6).

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
| `v0.3.0` | **Third release**, tagged on `main` after PRs #6 and #7 (agent skills). |
| `feat/agent-skills` | v0.3 work: skills renamed to permissions; agent skills (Agent Skills format, always or on demand, `search_skill` / `read_skill`), built-ins vendored by `skills:sync`, uploads with a security scan and AI review, Settings → Agent skills page, per-agent switches (migration 0006). |
| `v0.2.0` | **Second release**, tagged on `main` after PRs #3 (v0.2 work) and #4 (Next.js 16.4.6 security upgrade). |
| `feat/v0.2-agents-live-process` | v0.2 work: Security and Lead agents, Reviewer and Security in parallel, Lead approval with a risk floor, risk-based merge mode (migration 0005), face avatars, live process instead of the Live Agent Office. |
| `v0.1.0` | **First release (MVP)**, tagged on `main` after PR #1. Release notes in [CHANGELOG.md](../CHANGELOG.md); next steps in [roadmap.md](roadmap.md). |
| `feat/ai-agents` (7) | First live Switch scan (4 agents scored 99, $2.09). Fixes: an early 404 on the pre-minted run id no longer fails a scan; tests answered outside a scan add up on one row per agent and day; run results read from every page; the evaluation picker counts turns of adversarial attacks (10 conversations beat 201 fixed prompts). |
| `feat/ai-agents` (6) | Switch: verified end to end against local fakes, weekly scans (Inngest cron + toggle), monthly budgets as Switch cost caps. People's card moves, edits and removals on Activity (`task_events`). CI workflow; `npm run check` runs `next typegen` first so a fresh clone type-checks. |
| `feat/ai-agents` (5) | Switch Trust: connect a Switch account in Settings, SwitchAgent scans (agents registered in Switch, one evaluation each, health score + OWASP coverage) on connect and on demand, run in the background on Cloudhike jobs; OpenAI-compatible endpoint per agent for Switch's tests. |
| `feat/ai-agents` (4) | Answer the analyst from the board, converging reviews, session cache and lighter board polling, accent-free branch names. |
| `feat/ai-agents` (3) | Out-of-credit notice with switch-and-retry and opt-in automatic switch, agent log per card, notifications bell, model picker fix, header shows the repo name, sidebar account menu removed. Production prep: ESLint, Vitest (33 tests), Drizzle migrations (baseline), renamed to TechTeam, starter leftovers and 40 unused shadcn components + 9 dependencies removed. |
| `feat/ai-agents` (2) | Overview and Activity on real data (no fixtures left, empty states), AI team card, cost per step on Activity, Live Agent Office on the AI Team page (sprites from the office editor's scene bundle, live status polling). |
| `feat/ai-agents` | Agent pipeline on the board (Analysis column, stages, PRs, merge, follow-ups, auto pickup), simulated agents, Anthropic as a second provider, provider keys and company switch in Settings, a model per agent per company, Merge / rerun on cards, testing guide. |
