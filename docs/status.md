# Project status

Where the project stands, what's not real yet, and what to tackle next. Last updated **2026-11-20**
(release **v0.7.0**: references on cards, link captures, the Tester's comparison, add_dependency, agents fixing merge conflicts, leaner turns). For what has been tested and how to test the agents, see [testing.md](testing.md).

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
| Logo upload to local disk | ✅ Real | `lib/storage.ts` |
| Dashboard shell: sidebar, switcher, header, user menu | ✅ Real | `components/dashboard` |
| Light / dark / system theme | ✅ Real | `app/layout.tsx`, `user-menu.tsx` |
| Agents on the owner's Claude plan (local Claude Code, MCP endpoint, plan limits) | 🟡 Built and unit/integration-tested without spend; not run live yet | `lib/cli/`, `lib/cli-agents-config.ts`, `app/api/mcp`, [cli-agents.md](cli-agents.md) |
| Kanban board: columns, create/edit, drag and drop, search, filters | ✅ Real, persisted | `components/board`, `lib/board.ts` |
| GitHub issue sync (auto + Refresh, close → Done) | ✅ Real | `lib/github-issues.ts` |
| Remove task (soft delete) | ✅ Real | `removeCardAction` |
| Answer the analyst's question from the card, its menu or the agent log (answer kept for later runs) | ✅ Real, verified with OpenAI | `components/board/answer-dialog.tsx`, `answerCardAction`, `agent_runs.answer` |
| Agent log per card (tool calls, files changed, how each stage ended, cost) | ✅ Real (from runs started after it shipped) | `components/board/run-log-sheet.tsx`, `agent_run_steps` |
| Out of credit: board notice, move agents to the other company and retry, optional automatic switch | ✅ Real (automatic switch not run end to end) | `components/board/credit-notice.tsx`, `lib/agent-pipeline.ts` |
| Agent pipeline: Run / Stop, Analyst → Developer → Reviewer + Security (parallel) → Lead (approval + risk) → Tester → merge | ✅ Real (the v0.2 Security/Lead stages verified in simulated mode only), needs a key for each agent's company (OpenAI, Anthropic or OpenRouter; verified live with OpenAI on 2026-11-05 and with OpenRouter on 2026-11-19; the Claude path only against a local fake of the API). `AGENTS_SIMULATED=true` runs it with scripted agents | `lib/agent-pipeline.ts`, `lib/inngest/agent-run.ts` |
| Auto pickup of Todo cards; manual, automatic-when-low-risk or automatic merge | ✅ Real | `lib/inngest/agent-pickup.ts`, `lib/agent-run-config.ts` (`mergeDecision`), `lib/pull-requests.ts` |
| Follow-up card from the Tester on merge conflict / failing build | ✅ Real | `lib/pull-requests.ts` |
| Running the follow-up card fixes the PR: continues on its branch, the Developer merges the default branch in and resolves conflicts (`merge_default_branch`, `read_conflict`, `resolve_conflict`, `finish_merge`) | 🟡 Code + unit tests (merge verified on a local git repository); not run against GitHub or in a live run yet | `lib/branch-merge.ts`, `lib/merge-config.ts`, `lib/diff3.ts`, `lib/pull-requests.ts` |
| Overview page (stats, upcoming tasks, recent activity) | ✅ Real, from the board and the activity feed | `lib/overview.ts`, `lib/activity.ts` |
| AI Team: six default agents with faces, configure dialog (permissions, skills), Trust Score, spending, activity drawer, live working state | ✅ Real, persisted | `components/ai-team`, `lib/agents.ts`, `public/agents` |
| Agent skills: built-ins vendored by `npm run skills:sync` (modern-web-guidance, chrome-extensions, interface-design), uploads with validation + security scan + AI review, per-agent switches, `search_skill` / `read_skill` in every stage, always-loaded playbooks in the prompt, findings in the trust score | ✅ Real (server verified against the dev database with one real AI review; UI rendered with real data but not clicked through; a simulated run with skills not run end to end) | `agent-skills/`, `lib/agent-skills.ts`, `lib/skill-*.ts`, `components/skills`, `/settings/skills` |
| Live process (AI Team page): the six steps of each card in flight, live polling | ✅ Real | `components/ai-team/live-process.tsx`, `lib/live-process.ts` |
| AI drafting of instructions + AI-assisted trust scans | ✅ Real, needs an OpenAI, Anthropic or OpenRouter key (in that order) | `lib/agent-ai.ts` |
| Switch Trust: connect a Switch account, SwitchAgent scans (register agents, one evaluation each, health score + OWASP coverage) in the background via Cloudhike jobs | ✅ Live scan verified with Switch (2026-11-16, through ngrok); weekly scans and cost caps verified against local fakes | `lib/switch-trust.ts`, `docs/switch-trust.md` |
| Pull Requests page (agent PRs, approval and test verdicts, risk, Merge) | ✅ Real | `components/pull-requests`, `lib/pull-requests.ts` |
| Activity page (workspace timeline, incl. people's card moves, edits and removals) | ✅ Real | `lib/activity.ts`, `components/activity` |
| Notifications (header bell): PR ready, merged, merge blocked, needs info, run stopped, out of credit, provider switched | ✅ Real (polled every 30 s) | `lib/notifications.ts`, `components/dashboard/notifications-menu.tsx` |
| Settings page | ✅ Your account (profile, AI providers with account keys, spending across projects) and this workspace (automation, sandbox, Switch Trust, skills) editable; account and workspace details read-only | `app/dashboard/[workspaceId]/settings` |
| AI keys on the account, company and model per agent | ✅ Real (one account key serves every project; agents can mix OpenAI, Anthropic and OpenRouter; mixed run 50 with OpenAI + OpenRouter, Anthropic not in a mix yet) | `lib/ai-keys.ts`, `components/ai-team/agent-config-dialog.tsx` |
| OpenRouter (Google, DeepSeek, Z.ai, xAI, Moonshot models) | ✅ Real: all 10 models answer a strict tool call; live mixed run 50 (Developer DeepSeek V4 Pro, Tester DeepSeek V4.1 Flash, the rest OpenAI; $0.091, PR ready). Out of credit not tried live | `lib/openrouter.ts`, `lib/agent-loop.ts` |
| Agent sandbox (run tests, build, commands) | ✅ Real, verified live (run 49 on techteam-sandbox-demo, $0.17) | `lib/sandbox/`, `deploy/setup.sh`, [sandbox.md](sandbox.md) |
| PR previews and the Tester's browser | ✅ Real: live run 51 (SAN-3, $0.185): preview over HTTPS after CI, the Tester browsed it on desktop and mobile with screenshots; firewall rule applied on the VPS | `lib/sandbox/preview.ts`, `lib/sandbox/browser.ts`, `deploy/browser/` |
| Landing page `/` | ➖ None: redirects to the dashboard or sign-in | `app/page.tsx` |

## Dummy data and placeholders

Each is marked in code with `⚠️ DUMMY DATA` or `⚠️ PLACEHOLDER`:

- **Some permissions have no tool behind them**: Web research and Read environment secrets are
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
- **Agents run code only with the sandbox on** (Settings → Sandbox, a Docker host from `deploy/setup.sh`): then the
  Developer and the Tester run the tests, the build and one-line commands. Without it they verify statically and
  rely on CI. Node images only. With previews on, the Tester also tries the PR's preview in a headless browser; real devices, email and payments stay manual checks. The Developer still
  edits through the GitHub API.
- **One commit per file edit** on agent branches (contents API); merges are squashed, so `main` gets one commit.
- **Reviews are posted as comments**, not approvals: GitHub doesn't let the token's own account approve its own PR.
- **Auto pickup only takes never-run cards**, one at a time per workspace, every 2 minutes.
- **Live board progress is polled** (every 10 s while a run is active, database only), not pushed.
- **Workspace and account editing** isn't available (settings are read-only), nor deleting workspaces or accounts.
- **The agent pipeline locally requires the Inngest Dev Server** (`npm run dev` starts it with the app).
- **Live runs so far are on OpenAI** (GPT-6.1 Sol / GPT-6 Luna); the Anthropic path is verified only against a local
  fake of its API. OpenRouter has one live run (DeepSeek for the Developer and the Tester). Simulated agents always take the happy path.
- **Switch scans need a public URL** (not deployed yet: a tunnel such as ngrok), for both Switch's tests and the
  Cloudhike jobs. Weekly scans fail while it's unreachable.
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
| Unit tests only | 164 Vitest tests for pure logic (filters, model mapping, roles, trust scan, costs, credit detection, tools per stage, log steps, phases and working agents, risk floor and merge decision, CI gate, run metrics, live process, Switch mapping, card-change descriptions, skill frontmatter/zip/scan/search/prompt), run by CI on every push. No integration tests for the database, the sync or the pipeline yet. |
| Two `cn` helpers | shadcn components import `cn` from the `cn` npm package; app code uses `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`). Pick one. |
| `server-only` isn't installed as a package | Next.js handles it internally (optional per the Next docs), but scripts run outside Next (e.g. with `tsx`) can't import `server-only` modules without a shim. |
| Sequential updates in `reorderTasks` | One `UPDATE` per card in the moved columns. Fine at board sizes; batch it if columns grow large. |

## Suggested next steps

The plan lives in [roadmap.md](roadmap.md): smarter gates and the live process are done (v0.2), agent skills (v0.3), and
CI in the loop with a Metrics page (v0.4), and the sandbox with PR previews, the Tester's browser, account keys and
OpenRouter (v0.5), and references on cards with the sandbox's loose ends (v0.7). Next: v0.8, agents on the owner's
plans through local CLIs (Claude Code built; the isolation check and a live run remain, then Codex); then v0.9, a
shared project memory. Deploying TechTeam itself on the VPS moved to Later.

## History

| Commit | Change |
| --- | --- |
| `v0.7.0` | **Sixth release** (before v0.6): references on cards (files and captured links) for the agents, the Tester comparing the preview with them, the `interface-design` skill, the install step off private ranges, bold fonts in the browser image, `add_dependency`, agents fixing merge conflicts, leaner turns and no lost work at the turn limit (migrations 0013–0015; live runs 52–55). Next: v0.6 deploy. |
| `v0.5.0` | **Fifth release**: the sandbox (PR #12), account keys and a company per agent (#13, #14), OpenRouter (#15, #16) and previews with the Tester's browser. Next: v0.7 card references and sandbox polish, or v0.6 deploy. |
| `feat/sandbox-preview` | Sandbox milestone 2: PR previews over HTTPS on the sandbox host (Caddy, migrations 0011–0012), the Tester's headless browser (`browse_preview`) with screenshots in the agent log, a ufw rule keeping containers off the host's services. Built by two parallel agents on one shared contract. |
| `feat/openrouter` | OpenRouter as a third AI company (Google, DeepSeek, Z.ai, xAI, Moonshot; 10 models, routed only to hosts that keep no data), model tiers so a company move keeps the tier, failover to the first other company with a key; live run 50 ($0.091). |
| `feat/account-settings` | AI keys on the account (migration 0010) with optional workspace keys, spending this month across projects, company and model per agent (no team-wide provider switch), Settings regrouped into Your account / This workspace, one Settings item in the account menu. |
| `feat/sandbox` | Sandbox milestone 1: agent sandbox (`run_tests`, `run_build`, `run_command` in gVisor containers on a VPS, migration 0009), Settings → Sandbox, `deploy/setup.sh`; first live run (run 49, $0.17). |
| `8d05f34` | Auth (email + social), workspace onboarding with GitHub repo linking, theme tokens, AGENTS.md. |
| `7bcf7a6` | Dashboard shell with collapsible sidebar and workspace-scoped routes. |
| `2457df6` | Visual redesign: flat, tinted surfaces, Plus Jakarta Sans. |
| `b51f8f1` | Overview layout (dummy data). |
| `bff1cc4` | Persistent Kanban board with drag and drop, filters and card dialog. |
| `463701d` | GitHub issue sync; demo data removed. |
| `15e1257` | Card Run (Analyst + Inngest job) and Remove actions. |
| `d6f030e` | AI Team page: configurable agents, Skill Trust Score, spending, activity. |
| `v0.4.0` | **Fourth release**, tagged on `main` after PR #10 (CI in the loop, Metrics, board columns, failover and pickup fixes). |
| `feat/pipeline-ci-metrics` | v0.4 work: CI gate before review (migration 0008), Metrics page, board columns that scroll with Show more, the remaining test-plan checks before release. |
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
