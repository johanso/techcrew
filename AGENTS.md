<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TechTeam — Agent Guide

Read this file before changing anything. It sets the design system, typography, coding
conventions and folder structure every agent and contributor must follow.

Human-oriented documentation lives in [`README.md`](README.md), [`CHANGELOG.md`](CHANGELOG.md) (versions; add your
change under **Unreleased**), [`docs/roadmap.md`](docs/roadmap.md) (phases and how to release) and [`docs/`](docs): setup, architecture, data model,
features, GitHub integration, background jobs, security, project status and **agent testing**
([`docs/testing.md`](docs/testing.md): what's verified, what isn't, how to test without spending). Keep it current when behavior changes.

## 1. What the app does

A user signs in, creates a **workspace**, and links **exactly one GitHub repository** to it.
AI agents then work on that repository on the workspace's behalf.

```
sign-in / sign-up ─▶ /workspaces ──(no workspaces)──▶ /workspaces/new ──Next──▶ /dashboard/<id>
                         │                                  │
                         └──(pick one)──▶ /dashboard/<id>   ├─ name
                                                            ├─ icon or uploaded logo
                                                            └─ connect GitHub ─▶ select repository
```

- `/dashboard` redirects to the newest workspace (`/dashboard/<id>`), or to `/workspaces/new` if there is none.
- `/dashboard/<id>/…` 404s unless the signed-in user owns workspace `<id>`.
- An agent acting on a workspace uses the **owner's** GitHub token: `getGithubToken(workspace.ownerId)` from `lib/github.ts`.
  Work only on `workspace.githubRepoFullName`. Never use one workspace's token or repo for another.

## 2. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 App Router, React 19 | `proxy.ts` replaces `middleware.ts`. Read bundled docs first. |
| Styling | Tailwind CSS v4 (CSS-first config) | All theme tokens live in `app/globals.css`. There is no `tailwind.config`. |
| Components | shadcn/ui, **base-nova** style, on `@base-ui/react` | Not Radix. Compose with the `render` prop, not `asChild`. |
| Icons | `lucide-react` | Import the `…Icon` suffixed names (`RocketIcon`). |
| Database | PostgreSQL + Drizzle ORM | Schema in `db/schema.ts`; SQL migrations in `drizzle/` (`db:generate` → `db:migrate`). |
| Auth | Hosted Better Auth (CloudHike) | Token in an HTTP-only cookie; see `lib/auth.ts`. |
| GitHub | OAuth App (`repo read:user`) | Separate from social sign-in; tokens are AES-256-GCM encrypted. |
| File storage | Private S3 bucket | Never public; served through ownership-checked routes. |
| Jobs | Inngest | `lib/inngest/*`, `app/api/inngest`. |
| AI | OpenAI (`openai` SDK, Responses API) and Anthropic (`@anthropic-ai/sdk`, Messages API) | `lib/openai.ts`, `lib/anthropic.ts`; each agent's model picks the provider. Optional — features degrade without keys. |
| Quality | ESLint 9 (flat config, `eslint-config-next`) + Vitest 4 | `npm run check` = typegen + tsc + lint + unit tests. CI: `.github/workflows/ci.yml`. |

## 3. Commands

```bash
npm run dev          # dev server on http://localhost:3000
npm run build        # production build — must pass before you finish
npm run check        # next typegen + tsc + eslint + vitest — must pass before you finish (CI runs it + build)
npm test             # unit tests (Vitest); npm run test:watch while working
npm run lint         # ESLint
npm run db:generate  # after changing db/schema.ts: write the SQL migration into drizzle/ (read it, commit it)
npm run db:migrate   # apply pending migrations
npm run db:baseline  # once, for a database created with db:push before migrations: mark them applied
npm run db:studio    # inspect data
npm run inngest:dev  # local Inngest Dev Server — required for the agent pipeline (Run, auto pickup, auto-merge)
npx next typegen     # regenerate PageProps / RouteContext types after adding routes
npx shadcn add <c>   # add a shadcn component into components/ui
npm run skills:sync  # re-vendor the built-in agent skills at their pinned refs (-- --update <slug> to bump); commit the diff
```

## 4. Folder structure

```
app/
  (auth)/                 Sign-in, sign-up, social callback. actions.ts = auth server actions.
  api/
    auth/social/[provider]/   Starts GitHub/Google sign-in (hosted auth).
    github/connect/           Starts GitHub OAuth for repository access (state + PKCE).
    github/callback/          Finishes it; stores the encrypted token.
    workspaces/[id]/logo/     Streams a workspace logo from S3 to its owner.
    inngest/                  Inngest handler (serves the agent pipeline and auto pickup).
    switch-trust/scans/[scanId]/  Cloudhike job target: advances one SwitchAgent scan (single-use bearer token).
    switch-trust/agents/[agentId]/  OpenAI-compatible endpoint Switch evaluates an agent through (+ v1/chat/completions,
                              chat/completions aliases); derived per-agent bearer credential.
  workspaces/
    page.tsx              Workspace picker (post-sign-in landing). Redirects to /new if empty.
    new/page.tsx          Create-workspace page.
    actions.ts            createWorkspace, disconnectGithub server actions.
  dashboard/
    page.tsx              Redirects to the newest workspace.
    [workspaceId]/
      layout.tsx          Dashboard shell: sidebar + header. Owner check via getDashboardContext().
      page.tsx            Overview.
      actions.ts          Workspace-wide reads: getTeamStatusAction (live team), getNotificationsAction,
                          markNotificationsReadAction.
      board/ ai-team/ pull-requests/ activity/   One page.tsx per sidebar section.
      ai-team/actions.ts  saveAgentAction, scanAgentAction, switchScanAgentAction (SwitchAgent Scan), generateAgentAction
                          (auth + validation).
      board/actions.ts    createCardAction, updateCardAction, moveCardsAction, removeCardAction, runCardAction,
                          answerCardAction (answer the analyst + run again), stopCardAction, mergeCardAction, switchProviderAndRetryAction (out of credit), getRunLogAction
                          (agent log), syncIssuesAction (also refreshes agent PRs) (auth + validation).
      pull-requests/actions.ts  mergePullRequestAction (manual merge, via mergeManually).
      settings/           Account (#account), workspace (#workspace), AI providers (#ai: keys + provider switch), Switch
                          Trust (#switch), agent automation (#agents) and an Agent skills card (#skills) linking to skills/page.tsx (the
                          library on its own page). actions.ts: automation,
                          provider switch, auto failover toggle, save/remove provider key, connect/disconnect Switch,
                          inspectSkillAction / installSkillAction (upload, two steps), saveSkillAssignmentsAction,
                          deleteSkillAction.
  globals.css             THE theme: palette, semantic tokens, Tailwind mapping.
  layout.tsx              Root layout; loads Plus Jakarta Sans, ThemeProvider.
  page.tsx                `/`: redirects to /dashboard (signed in) or /sign-in. No landing page yet.
components/
  ui/                     shadcn primitives. Generated — do not hand-edit; restyle via tokens.
  auth/                   Auth-only UI (forms, social buttons, brand icons, FormMessage).
  workspace/              Workspace UI (avatar, create form, appearance + repo pickers, draft storage).
  board/                  Kanban: kanban-board (state + DndContext), board-column, board-card, card-dialog (create + edit),
                          board-toolbar (search + type tabs), board-filters (pure matching logic),
                          use-github-sync (polling hook), github-sync-controls (Refresh button, sync notice),
                          issue-meta (type/priority/column colors + PriorityBadge, IssueTypePill, DueDate — reuse everywhere),
                          agent-run-status (the run line on a card: stage, needs info, stopped, out of credit, ready to
                          merge), run-log-sheet (agent log panel), credit-notice (out of credit: switch and retry),
                          answer-dialog (answer the analyst's question).
  pull-requests/          pull-requests-view (PR list, verdict chips), merge-button.
  activity/               activity-timeline (Activity page: events grouped by day, Show older).
  settings/               agent-automation-form (task pickup + merge mode), provider-switch-form, auto-failover-toggle,
                          provider-key-form
                          (masked key + show/hide), switch-connection-form (Switch Trust account), switch-weekly-toggle,
                          option-cards (radio
                          cards shared by the settings forms).
  ai-team/                AI Team: ai-team-view (page markup), agent-roster (cards + open overlay state), agent-card
                          (live working state), agent-config-dialog (form + PermissionPicker + Draft with AI), trust-panel,
                          spending-panel, skills-panel (only the agent's skills with switches + "Add a skill" search, setAgentSkillAction), agent-activity-sheet, agent-visuals (AgentPortrait, AgentStatusBadge, BudgetMeter,
                          TrustRing), agent-face (the face image + initial fallback), live-process (the six steps of each
                          card in flight), live-team (LiveTeamProvider + useLiveTeam: one poll of getTeamStatusAction; also
                          keeps the Overview's AI team card live), trust-scan-watcher (refreshes the page while a
                          SwitchAgent scan is pending).
  skills/                 Agent skills UI: skill-library (Settings → Agent skills page: search + agent filter, list,
                          Assign, New version, Delete), skill-filters (pure
                          search/filter, tested), skill-upload-button (the dialog), skill-upload (choose → inspect → confirm → install → Done, in a
                          dialog), skill-badges (SkillBadges, SkillScanChip,
                          SkillAgents, agentOf), skill-findings, agent-checkboxes ("Assign to" the six agents).
  dashboard/              Overview sections: stat-tile, upcoming-tasks, team-status (AI team card, live), recent-activity,
                          agent-avatar (AgentAvatar, UserInitial, AGENT_TONE_CLASS), activity-kind (ACTIVITY_KIND,
                          ActivityAvatar).
                          Dashboard shell: app-sidebar, workspace-switcher, user-menu (header avatar only), dashboard-header,
                          notifications-menu (the bell),
                          nav.ts (sidebar sections — server-safe), use-dashboard-section.ts (client hook),
                          page-header (PageHeader, SurfaceHeader, DetailGrid), stat-tile, section-empty (SectionEmpty, SurfaceEmpty),
                          overview-view (Overview markup; the page only loads data).
  app-header.tsx          Signed-in top bar.
  brand.tsx               Product mark.
hooks/                    Client hooks (use-field-errors, use-mobile).
lib/                      Server logic. Files that touch secrets/DB start with `import "server-only"`.
  auth.ts                 Hosted-auth client, session cookie; getSession reuses sessions validated in the last 60 s
                          (session-cache.ts: the auth service rate-limits the dashboard's polls).
  current-user.ts         getCurrentUser() / requireUser(returnTo).
  github.ts               GitHub OAuth + REST + connection persistence.
  crypto.ts               encrypt / decrypt for secrets at rest.
  ai-keys.ts              Workspace AI provider keys: getAIKeys (workspace key, else env), getProviderKeyViews (masked),
                          verifyProviderKey, saveProviderKey / removeProviderKey (encrypted).
  storage.ts              S3 uploads/reads, logo limits.
  workspaces.ts           Workspace queries (always scoped by owner) + getDashboardContext().
  overview.ts             getOverviewData(): stats + upcoming tasks from getBoardData, recent work activity.
  activity.ts             getActivityFeed(): agent_activity + cards people created + task_events, newest first;
                          WORK_ACTIVITY_KINDS.
  agent-config.ts         AI Team vocabulary shared by server + client: roles + defaults (models per provider), PERMISSIONS,
                          AGENT_MODELS (provider + pricing), PROVIDERS, EQUIVALENT_MODEL, agentModelFor, limits.
  agent-trust.ts          Trust Score: scanAgentRules() (deterministic; permissions, instructions, budget, enabled uploaded
                          skills' scan findings), trustGrade(). Pure.
  agent-skills-config.ts  Agent skills vocabulary shared by server + client: SKILL_TYPES / SKILL_LOADS / SKILL_SOURCES,
                          limits, metadata keys (skillMetadata), SkillScan + skillScanStatus, SkillView, defaultAssignment.
  agent-skills.ts         Skill library: ensureBuiltinSkills (rows + default assignments, never re-enables), getSkillLibrary,
                          getAgentSkills / promptSkills (runtime), searchSkill / readSkill (the two tools), getTrustSkills.
  builtin-skills.ts       BUILTIN_SKILLS from agent-skills/catalog.json, readBuiltinFile (only catalog-listed paths).
  skill-format.ts         Pure: parseFrontmatter (YAML subset), parseSkillMarkdown (Agent Skills rules), cleanSkillPath,
                          docMeta (search title/summary), contentVersion. Mirrored by scripts/sync-agent-skills.mjs.
  skill-zip.ts            ZIP reader on node:zlib: listZip, readZipEntry (declared-size cap + CRC; links reported).
  skill-package.ts        readSkillPackage: an upload (.md or .zip) → validated text-only package within the limits.
  skill-scan.ts           Pure: scanSkillFiles (deterministic security rules), sortSkillFindings.
  skill-runtime.ts        Pure: skillsPromptBlock (always vs on demand), rankSkillFiles + formatSearchResults, pageSkillFile.
  skill-install.ts        inspectSkillUpload (rules → AI review, sealed token) / installSkillUpload, setAgentSkill,
                          setSkillAssignments, deleteUploadedSkill; every change rescans the affected agents' trust.
  switch-trust.ts         Switch Trust: connection (encrypted key, connectSwitch/disconnectSwitch), SwitchAgent scans
                          (requestSwitchScans → Cloudhike job → advanceTrustScan: register, 1 evaluation, poll, save),
                          getLatestTrustScans, agent endpoint credential. See docs/switch-trust.md.
  switch-api.ts           Switch Trust REST client (identity, register agent, endpoint, assignment, trigger, run, summary).
  switch-trust-config.ts  Pure: scan statuses, pickFastEvaluation, runPhase, buildSwitchReport, parseEvalMessages.
  switch-eval.ts          answerEvaluation(): an agent answers one Switch test with its model + instructions (+ its
                          always-loaded skills), cost logged.
  jobs.ts                 Cloudhike Jobs: enqueueJob, getJobRun, publicAppUrl (null for local addresses).
  agent-ai.ts             Config AI (OpenAI if configured, else Anthropic): generateAgentConfig() (repo-aware instructions),
                          scanAgentWithAI(), reviewSkillWithAI() (upload review + type/load/roles), isConfigAIAvailable().
  openai.ts               OpenAI client (null without a key), responseCostMicros().
  anthropic.ts            Anthropic client (null without a key), messageCostMicros(), toClaudeSchema().
  agents.ts               Agents persistence: ensureDefaultAgents(), getAgentTeam(), getTeamOverview() (read-only: members +
                          runs in flight for the live process and the Overview),
                          updateAgentConfig(), refreshRuleTrust(), saveTrustScan(),
                          checkAgentCanRun(), logAgentActivity(), stage activity rows, agentMaxTurns(); getAgent(),
                          RUN_AGENT_ID (the analyst), taskKeyPrefix().
  agent-run-config.ts     Pipeline vocabulary shared by server + client: RUN_STAGES + PHASE_META (phases: agents + column),
                          AGENT_STAGES + STAGE_META (one per agent), workingAgents, TOOL_LABEL, RUN_STATUSES,
                          MAX_REWORK_ROUNDS, max-turn limits, ANSWER_MAX + parseAnswer, brief/review/security/Lead/test
                          report types, riskFloor + applyRiskFloor, MERGE_MODES + mergeDecision, BoardCardRun.
  live-process.ts         Pure, client-safe: LiveRun (a run in flight) → liveProcessSteps (six steps), agentDoingSentence.
  agent-runs.ts           agent_runs persistence: createRun, markStageRunning, finishRun, getActiveRun, getLatestRuns,
                          getEndedStages / getWorkingAgents (who works now, two in review), placeTask (moves +
                          assigns a card for the pipeline), releaseTask, replaceWaitingRuns (rerun), findAutoPickupCandidates;
                          agent log: saveRunSteps, saveStageEnd, getTaskRunLog.
  agent-pipeline.ts       Stage work: prompts (+ skills block), beginStage / runStageTurn (pause, budget, permissions and
                          skills read every turn),
                          branch, PR, review/security/approval/test recording (+ deterministic pre-checks and risk
                          floor), needs-info + answerAnalyst
                          (earlier questions and answers go into later runs' prompts), readyToMerge,
                          pipelineModelProblem (Run pre-check: every agent's model has a key), out-of-credit handling
                          (stop with `failure`, or auto failover + stage restart), stopRun (log + notify).
  agent-simulated.ts      AGENTS_SIMULATED=true: scripted stand-in for the model (one real tool call, plus search_skill +
                          read_skill when the agent has skills, then a passing result).
  agent-loop.ts           One model turn with function tools, per provider: OpenAI Responses (previous_response_id, forced
                          finish tool) or Anthropic Messages (history in agent_run_messages, last-turn system message);
                          modelUnavailableReason(), initialLoopState().
  agent-tools.ts          Agent tools on the GitHub API, filtered by stage + permissions; search_skill / read_skill when the
                          agent has skills; protected paths, manifest gate;
                          toolStep() (a call → agent log step; never stores file contents).
  pull-requests.ts        Agent PRs: mergeAgentPullRequest (mergeable + CI green, else Tester follow-up card),
                          mergeManually (user merge: card or PR page), refreshOpenPullRequests, getRerunPullRequest +
                          adoptPullRequest (rerun on the same PR), listPullRequests.
  board-config.ts         Board vocabulary shared by server + client: columns, issue types, priorities, BoardCard.
  board.ts                Board persistence (tasks table): getBoardData (with latest runs), getBoardCard, createTask,
                          updateTask, reorderTasks, removeTask, assignTask, createAgentTask (agent-filed cards),
                          parseCardInput / parseBoardInput (server-side validation).
  inngest/agent-run.ts    agentTaskRun: the agent pipeline (`agent/task.run`, cancel: `agent/task.cancel`). One step per
                          model turn; stages, rework rounds and merge.
  inngest/agent-pickup.ts agentAutoPickup: cron every 2 min, starts runs on never-run Todo cards (auto pickup on).
  inngest/switch-weekly.ts switchWeeklyScans: Mondays 06:00 UTC, queues SwitchAgent scans (Scan every week on).
  task-events.ts          People's card moves/edits/removals for Activity: taskSnapshots (before a change),
                          logCardEdited / logCardsMoved / logCardRemoved (never throw), describeCardChanges.
  github-issues.ts        syncWorkspaceIssues(): pulls the repo's GitHub issues onto the board (see "GitHub issues").
  notifications.ts        Header bell: notify() (never throws), listNotifications, markNotificationsRead, agentLogHref.
  workspace-icons.ts      Selectable icon set (shared client/server).
  utils.ts                cn(), initials().
db/                       Drizzle client (index.ts) and schema (schema.ts).
drizzle/                  Generated SQL migrations + snapshots. 0000_baseline = the whole schema as of 2026-11. Never hand-edit
                          a migration that has been applied anywhere; add a new one.
test/                     server-only.ts (stand-in for unit tests), zip.ts (tiny ZIP writer for skill tests). Tests live
                          next to their module as *.test.ts.
agent-skills/             Built-in agent skills, vendored: sources.json (repo, path, pinned ref, license, type, load, roles,
                          usage note), catalog.json (generated: metadata + per-file title/summary for search), <slug>/
                          (files exactly as published + SOURCE.md + upstream LICENSE). Never hand-edit; run skills:sync.
public/                   agents/<key>.webp: one face per agent role (256×256, round with transparent corners).
scripts/                  db-baseline.mjs (mark migrations applied on a pushed DB), sync-agent-skills.mjs (skills:sync).
proxy.ts                  Optimistic cookie guard for /dashboard and /workspaces.
```

Where new code goes:

- A route → `app/<segment>/page.tsx`; its mutations → `app/<segment>/actions.ts` (`"use server"`).
- Feature UI → `components/<feature>/`; only cross-feature UI at `components/` root.
- DB queries and third-party API calls → `lib/<domain>.ts`, never inline in components.
- Route handlers only for things server actions can't do: OAuth redirects, binary responses, webhooks.
- A new dashboard section → add it to `DASHBOARD_NAV` in `components/dashboard/nav.ts` and create
  `app/dashboard/[workspaceId]/<segment>/page.tsx`. Sidebar, breadcrumb and switcher pick it up automatically.
- Keep config modules (like `nav.ts`) free of hooks so Server Components can import them; put hooks in a
  separate `"use client"` file.

## 5. Coding conventions

**TypeScript & style**
- Strict TypeScript. No `any`; narrow `unknown` with type guards (see `isWorkspaceIcon`, `isSafeRedirectPath`).
- Double quotes, semicolons, 2-space indent, trailing commas. Files are `kebab-case.tsx`; components `PascalCase`; hooks `use-*.ts` exporting `useX`.
- Imports always use the `@/` alias. Order: React/Next → third-party → `@/` modules.
- Comments explain *why*, not what. Add a one-line doc comment to exported functions whose purpose isn't obvious from the name.

**Server vs client**
- Default to Server Components. Add `"use client"` only for state, effects or browser APIs, and push it to the smallest leaf.
- Server-only modules start with `import "server-only"`. Client code may `import type` from them, never values.
- Pass slow data to the client as an un-awaited promise and `use()` it inside `<Suspense>` (see the repo list on `/workspaces/new`).

**Auth & authorization**
- Get the user with `requireUser(returnTo)` (pages/actions) or `getCurrentUser()` (route handlers). `proxy.ts` is only an optimistic guard.
- Pages under `/dashboard/[workspaceId]` call `getDashboardContext(workspaceId)` — never query the workspace by id
  directly. It is `cache()`d, so layout and page share one lookup.
- Every id that comes from a request is untrusted: load it with an owner-scoped query (`getOwnedWorkspace(ownerId, id)`).
- Post-auth redirects go through `isSafeRedirectPath` — never redirect to a raw query value.

**Server actions & forms**
- Action signature: `(prev: State, formData: FormData) => Promise<State>`, used with `useActionState`.
- Validate every field on the server even if the client validated it. Return `{ errors: { field: "Message." } }` for field errors and `{ message }` for form-level ones; `redirect()` on success.
- Show field errors with `useFieldErrors(state)` (`hooks/use-field-errors.ts`) so they clear on edit.
- Re-validate external state at write time (e.g. `createWorkspace` re-reads the repo from GitHub instead of trusting client data).

**Secrets & external services**
- GitHub tokens are stored only via `saveGithubConnection` (encrypted) and read only via `getGithubToken`. Never send a token, ciphertext or S3 key to the client.
- AI provider keys are stored only via `saveProviderKey` (verified with the provider, encrypted) and read only via
  `getAIKeys`. The client only ever gets `ProviderKeyView` (source + masked hint); the show/hide eye applies to what the
  user is typing, never to a saved key. Model calls take the key as an argument (`openAIClient(key)`, `anthropicClient(key)`).
- Uploaded files go to private S3 via `lib/storage.ts`. Allowed logo types: PNG, JPEG, WebP, GIF, ≤ 1 MB. No SVG (script risk).
- Handle a GitHub `401` as "connection expired": prompt the user to reconnect.
- New env vars must be added to `.env.example` with a placeholder and a comment. Never put real credentials in `.env.example`.

**Database**
- Change `db/schema.ts`, then `npm run db:generate`, read the SQL, `npm run db:migrate`, and commit schema + migration +
  code together. `db:push` is for throwaway local databases only. Never touch the `auth` schema (owned by the hosted
  auth service).
- Tables are `snake_case` plural; columns `snake_case` in SQL, `camelCase` in TS. Foreign keys to `users.id` use `onDelete: "cascade"`.

**Tests & lint**
- `npm run check` must pass (tsc, ESLint, Vitest). Don't silence a lint rule to get there; fix the code, or explain the
  disable in a comment on that line.
- Pure logic gets a unit test next to it (`foo.ts` → `foo.test.ts`): parsers, mappings, cost math, classifiers.
  `server-only` modules import fine in tests; never hit the database or a real API from a unit test.
- Prefix a deliberately unused binding with `_` (e.g. dropping a field with a rest destructure).

## 6. Design system

### 6.1 Color palette

Raw colors exist **only** in `app/globals.css` as `--palette-*`. Everything else uses semantic tokens.
To re-skin the app, edit the palette there — no component changes needed.

**Primary**

| Name | Hex | Tailwind utility | Use for |
| --- | --- | --- | --- |
| brand | `#006fbb` | `bg-brand` `text-brand` (also `primary`) | Primary buttons, selected states, links, brand mark, completed steps. |
| accent | `#fbc100` | `bg-brand-accent` `text-brand-accent` | Sparse highlights only: a badge, a key word on a dark panel. Never large fills or body text. Text on it: `text-brand-accent-foreground`. |
| darkest | `#21262c` | `bg-darkest` `text-darkest` (also `foreground`) | Body text, dark panels, GitHub/neutral-dark buttons, dark-mode background. |
| lightest | `#eef1f3` | `bg-lightest` (base of `muted`, `secondary`, `canvas`, `sidebar`) | Subtle surfaces. Same in light and dark — for theme-aware backgrounds use `bg-canvas` / `bg-muted`. |

**Secondary**

| Name | Hex | Tailwind utility | Use for |
| --- | --- | --- | --- |
| dark | `#7f90a4` | `text-dark` | Secondary text **on dark surfaces only**. On light surfaces use `text-muted-foreground`. |
| light | `#d7d7d7` | `border-light` (also `border`, `input`) | Borders, dividers, input outlines. |
| action | `#009cdf` | `text-action` `ring-action` (also `ring`) | Focus rings, informational highlights, icons on dark panels. |
| success | `#61bf33` | `bg-success` `text-success` | Success icons, progress fills, status dots. |
| warning | `#e96b1a` | `bg-warning` `text-warning` | Warning icons, fills, badges. |
| error | `#df1919` | `bg-error` `text-error` (also `destructive`) | Errors, destructive actions, invalid fields. |

**Rules**
1. Never write hex/rgb/oklch values or Tailwind palette colors (`sky-500`, `zinc-950`, `emerald-600` …) in components. If a token is missing, add it to `globals.css` (palette → semantic → `@theme inline`).
2. Prefer semantic shadcn tokens (`bg-background`, `text-muted-foreground`, `border`) for generic UI; use palette utilities (`bg-brand`, `text-success`) when the meaning is the brand color itself.
3. Name clash: shadcn's `accent` is the subtle hover surface. The yellow palette accent is `brand-accent`.
4. Palette utilities (`bg-lightest`, `text-brand` …) do **not** change with the theme. For surfaces use the
   semantic tokens: `bg-canvas` (page background behind cards: lightest → darkest), `bg-card`, `bg-muted`.
   For brand-colored **text or icons on neutral surfaces** use `text-brand-emphasis` (brand in light, the brighter
   action blue in dark — plain brand blue is unreadable on dark). In the sidebar the same role is `text-sidebar-primary`.
   Keep `bg-brand`/`text-brand` for brand *fills* and for text on white-only elements (the white CTA on a hero).
5. Contrast (WCAG AA): `success`, `warning`, `action` and `dark` are **below 4.5:1 on white** — use them for icons, borders, fills and large text, not small body text on light backgrounds. Pair text-on-color with its `-foreground` token (`bg-success text-success-foreground`). `brand`, `error`, `darkest` and `muted-foreground` are safe for text on white.
6. Tints: use opacity modifiers on tokens — `bg-brand/10`, `border-destructive/30`, `bg-muted/60`.
7. Dark mode: `next-themes` toggles `.dark` on `<html>` (user menu → Theme; default light). Tokens are redefined
   under `.dark` in `globals.css`. Components must not use `dark:` color overrides; fix or add a token instead.

### 6.2 Visual language — "flat, tinted, hairline"

The look is modern and calm: generous whitespace, bold geometric type, and **no shadows on the page**.
Hierarchy comes from three tinted background layers plus hairline borders:

```
sidebar (bg-sidebar, brand-tinted grey)  <  canvas panel (bg-canvas)  <  card (bg-card, white)
```

1. **No shadows on resting UI.** `shadow-2xs`, `shadow-xs` and `shadow-sm` are set to *none* in the theme, so
   shadcn inputs, buttons and panels are flat too. Don't add `shadow-*`, glows, blurred blobs or `drop-shadow` to
   cards, buttons, tiles or nav items. Express state with **border color, background tint or a 1-px ring** instead
   (e.g. hover `border-brand/30`, active `ring-1 ring-sidebar-border`).
2. **Only floating layers get a shadow** — dropdowns, popovers, tooltips, dialogs (`shadow-md`/`lg`/`xl`, already
   built into the shadcn primitives). Never use those sizes on in-page content.
3. **Hairline borders.** `--border` is deliberately soft; use the default `border` (or `border-border/70` for inner
   dividers). Never use dashed borders.
4. **One brand-filled hero per view** at most (`surface-brand`), for the single most important block. Everything else
   is a white `surface`.
5. **Color in small doses:** brand color lives in the hero, primary buttons, active states and icon tiles. Status
   colors appear in tiles/badges, never as large fills.

**Surface utilities** (defined in `app/globals.css` — use them instead of re-composing card classes):

| Utility | What it is | Typical use |
| --- | --- | --- |
| `surface` | `bg-card` + hairline border + `rounded-xl` | Every card/panel. Add padding yourself (`p-5`/`p-6`). |
| `surface surface-interactive` | Border/background pick up the brand tint on hover, ring on focus | Clickable cards (`<Link className="surface surface-interactive …">`). |
| `surface-brand` | Brand fill with radial highlights, white text, `rounded-xl`, clips decorations | The one hero card. Decorate with `border-white/15` rings at `-z-10`; chips use `bg-white/15 ring-1 ring-white/20`. |
| `icon-tile` | 40-px rounded chip tinted from its own text color | `icon-tile text-brand-emphasis`, `icon-tile text-success`. Override size/radius with normal utilities. |
| `eyebrow` | 12 px, semibold, uppercase, `0.08em` tracking | Labels above titles, sidebar group labels, detail labels. |

**Building blocks** (`components/dashboard/`): `PageHeader` (eyebrow + h1 + description + actions), `SurfaceHeader`
(icon + title + subtitle + actions row at the top of a `surface`), `DetailGrid` (label/value pairs), `StatTile`
(icon tile + label + value + hint; `tone` = a text color class), `SectionEmpty` (empty state). Reach for these before
writing new markup so every page keeps the same rhythm.

### 6.3 Typography

Typeface: **Plus Jakarta Sans** (loaded in `app/layout.tsx` via `next/font`, weights 400–800), exposed as `font-sans`
and `font-heading`. Base size **14 px** (`text-sm`); `h1`–`h4` get tight tracking and `text-balance` globally.

| Role | Classes | Size / line height | Weight |
| --- | --- | --- | --- |
| Page title (h1) | `text-2xl font-bold sm:text-3xl` (via `PageHeader`) | 24→30 | 700 |
| Hero headline | `text-3xl font-bold sm:text-4xl tracking-tight` | 30→36 | 700 |
| Section title (h2) | `text-lg font-bold` | 18 / 28 | 700 |
| Card title | `text-base font-bold` (via `SurfaceHeader`) | 16 / 24 | 700 |
| Metric value | `text-xl font-bold tracking-tight tabular-nums` | 20 / 28 | 700 |
| Body | `text-sm` | 14 / 20 | 400 |
| Secondary text | `text-sm text-muted-foreground` | 14 / 20 | 400 |
| Caption / helper | `text-xs text-muted-foreground` | 12 / 16 | 400 |
| Eyebrow / label | `eyebrow` + `text-brand-emphasis` (page) or `text-muted-foreground` (groups, details) | 12 / 16 | 600 |
| Emphasis in text / nav | `font-medium` / `font-semibold` (active nav) | — | 500 / 600 |

**Rules**
- One `h1` per page. Don't skip heading levels for styling — pick the level, then the classes.
- Titles, card titles and metric values are **bold (700)**; body stays 400. Contrast between the two is the point.
- Numbers that change or align use `tabular-nums`.
- Use sentence case for titles, buttons and labels ("Create a new workspace", not "Create A New Workspace").
- Truncate user-provided strings in constrained rows (`truncate`, `line-clamp-1`).

### 6.4 Layout & components

- **Dashboard shell (`/dashboard/[workspaceId]/*`):** provided by the layout — `Sidebar variant="inset" collapsible="icon"`
  (state persisted in the `sidebar_state` cookie, toggle with ⌘/Ctrl+B). Content is a rounded `bg-canvas` panel with its
  own scroll and a sticky, translucent `h-16` header (`bg-canvas/80 backdrop-blur-md`). Pages render only their content:
  start with `<PageHeader eyebrow title description actions? />`, then sections separated by `gap-8`.
  Every sidebar item needs a `tooltip` (icon-only mode).
- **Overview layout** (`OverviewView`): welcome header → 3 `StatTile`s (Open tasks, In progress, PR ready) →
  `grid lg:grid-cols-5` with `UpcomingTasks` (`lg:col-span-3`) and `TeamStatus` (`lg:col-span-2`, agents from the
  read-only `getTeamOverview`, live through a `LiveTeamProvider`) → `RecentActivity` list. The live process is only on
  the AI Team page. Status → icon + tone maps live next to each component (`TASK_STATUS`); activity kinds in `ACTIVITY_KIND`.
- **Board** (`/dashboard/[id]/board`): six columns — Todo, Analysis, In Development, In Review, Testing, Done —
  each with a light tint from `COLUMN_STYLE` (slate, brand, sky, amber, orange, green). Cards show type pill, key
  (`PREFIX-<number>`, always — GitHub cards add `#<issue>` in the footer), title, labels, priority, due date and the
  assigned agent. "New" (Feature / Bug / Issue) and each column's "+" open `CardDialog` in create mode preset to that
  type/column; clicking a card (or Enter on a focused card) opens the same dialog in edit mode.
  Each card has a ▶ **Run** button and a **⋯** menu (Run or Stop agents, Remove task). In Done, ▶ is a static check
  (rerun stays in the menu). While its PR waits for a manual
  merge, ▶ becomes **Merge** (`mergeCardAction` → `mergeManually`, the same checks as the Pull Requests page) and the menu
  adds Merge and View PR on GitHub; the board reloads afterwards (card to Done, or the Tester's follow-up card).
  When the analyst asked a question (`needs_info`), ▶ becomes **Answer** (also in the ⋯ menu and the agent log):
  `AnswerDialog` → `answerCardAction` saves the answer on that run (`agent_runs.answer`, posted under the question on
  the GitHub issue when the question was posted there) and runs the card again. Every later run of the card gets the
  last questions and answers in its analysis and development prompts (`earlierQuestionsBlock`).
  Running a card again while it has an open PR continues on that branch and PR (`adoptPullRequest`, verdicts reset;
  earlier runs waiting on it end as replaced, `replaceWaitingRuns`); the developer's brief says so (`rerunBlock`).
  The PR is re-checked on GitHub first (`getRerunPullRequest`), and every board sync applies merges/closes done on
  GitHub (`refreshOpenPullRequests` in `syncIssuesAction`), so cards never offer Merge on a closed PR. They render as siblings of the card inside
  the sortable wrapper (the card is only the drag *activator*), so they never start a drag or open the dialog.
  - **Run** (`runCardAction`) creates an `agent_runs` row, queues `agent/task.run` with its `runId`, then moves the card
    to Analysis assigned to the analyst; if queuing fails the run is marked failed and nothing moves. Refused while a
    run is active, when an agent's model has no provider key (`pipelineModelProblem`), or when the analyst is paused/over budget. Locally: `npm run inngest:dev`.
  - **Stop agents** (`stopCardAction`) marks the run cancelled, sends `agent/task.cancel` and unassigns the card.
  - Cards show their latest run with `AgentRunStatus`; ▶ is disabled while it is queued/running, and the board re-reads
    itself every 10 s while any card has an active run (`useGithubSync({ live })` → `getBoardAction`, database only;
    GitHub stays on the 60 s sync).
  - **Remove task** (`removeCardAction`, after an `AlertDialog` confirm) sets `removed_at`. Rows are never deleted:
    keys aren't reused, and a removed GitHub card is never imported again (the issue stays open on GitHub).
    Every board query goes through `onBoard()` in `lib/board.ts`, which skips removed rows. The board opts out of the page max width with
  `data-page-width="full"` and scrolls horizontally (snapping on mobile).
- **Board filters** (`BoardToolbar` + `board-filters.ts`): a search box (title or key — "ACM-142", "acm142",
  "#142", "142"; `/` focuses it, Escape clears) and segmented type tabs (All / Features / Bugs / Issues, counts follow
  the search). Filters only *hide* cards — `columns` keeps the full order, so drag and drop stays consistent while
  filtered. Column badges show `visible/total`. Creating a card the filters would hide resets them.
- **Board persistence** (`tasks` table): create/edit await the server action and render what it returns (real id
  and key `PREFIX-<number>`, numbered per workspace under a row lock). Drag and drop is optimistic: on drop, the
  board sends the full ordered id list of every column that changed (`moveCardsAction`); if the server refuses, it
  restores the pre-drag snapshot and shows an inline error. The server re-checks that every id belongs to the
  workspace. New cards take `min(position) - 1` (top); positions are sort keys, not indexes.
- **GitHub issues** (`lib/github-issues.ts`): open issues of the linked repo become cards (pull requests are
  skipped). The board syncs on mount, on tab refocus (≥15 s gap), every 60 s while visible, and via **Refresh**
  (`useGithubSync`). Syncs are incremental via GitHub's `since` (`workspaces.github_issues_synced_at`, minus 60 s
  overlap) and serialized by the same workspace row lock as card creation; `(workspace_id, github_issue_id)` is
  unique so a card can never be duplicated. Ownership rules — keep them when adding fields:
  - **GitHub owns** title, description, labels, open/closed. Refreshed when the issue changes; read-only in the
    dialog ("Open on GitHub"); `updateCardAction` validates/saves only board fields for synced cards.
  - **The board owns** column, type, priority, due date. Set once on import (type/priority from labels:
    `typeFromLabels`, `priorityFromLabels`), never overwritten — except closing an issue moves it to Done and
    reopening moves it back to Todo.
  - A fresh board is never applied mid-drag or while a move is saving (it would undo the move on screen); the hook
    defers it and refetches when the board settles. Auto-sync pauses on `not_connected` / `reconnect` / `no_access`.
  - Cards created in the app have no GitHub issue (`github: null`) and are not pushed to GitHub.
  - Every visit (navigation or reload) starts a sync, and the header says "Syncing with GitHub…" from the first paint.
  - A removed card stays removed: the sync skips rows with `removed_at`, whatever happens to the issue.
- **Drag and drop** uses `@dnd-kit/core` + `@dnd-kit/sortable` (stable v6/v10 API, not the 0.x `@dnd-kit/react`).
  Rules: `MouseSensor` (6 px distance) + `TouchSensor` (180 ms delay) + `KeyboardSensor` (Space only, so Enter can
  open the card; clicks within 250 ms of a drop are ignored) — never `PointerSensor`
  alone (it blocks touch scrolling). Pass a stable `id` (`useId()`) to `DndContext` to avoid hydration mismatches.
  Cross-column moves in `onDragOver`, same-column reorder in `onDragEnd`, restore a snapshot in `onDragCancel`.
  Keyboard: ←/→ change column (custom coordinate getter), ↑/↓ reorder; announcements name the column and position.
  The drag copy renders in `DragOverlay` (it may use `shadow-lg` — it's a floating layer) and must not use dnd hooks.
- **Issue visuals are centralized** in `components/board/issue-meta.tsx` (type icons/colors, priority dots, column
  tints). The Overview's upcoming tasks use the same `PriorityBadge`. Never redefine these maps locally.
- **Base UI Select:** pass `items` to `<Select>` so `<SelectValue />` shows labels, and size triggers with
  `data-[size=default]:h-10` (a plain `h-10` loses to the primitive's attribute selector).
- **AI Team** (`/dashboard/[id]/ai-team`): header → 3 `StatTile`s (Active agents, Trust Score, Monthly spending) →
  6 `AgentCard`s (`sm:grid-cols-2 xl:grid-cols-3`) → `LiveProcess`; cards and live process share one `LiveTeamProvider`.
  Agents are rows in `agents`, one per role key (analyst, developer, reviewer, security, lead, tester), created on first
  use by `ensureDefaultAgents` (Run and the page both call it; it adds new roles to existing workspaces). Identity (name,
  role, tone, face) is fixed per key in `AGENT_ROLES` and `public/agents/<key>.webp`; users configure description,
  instructions, model, permissions, budget, skills and active/paused. Rules:
  - **Faces**: every agent shows through `AgentPortrait` (sizes xs–lg, status dot, `working` ring) or `AgentAvatar`
    (small, labeled), both on `AgentFace`: a plain `<img>` with the tinted initial as fallback. `alt` is empty when the
    name is shown next to it. A new role needs its `public/agents/<key>.webp` and a tone (tokens only: `AGENT_TONE_CLASS`).
  - **Spend** lives in `agent_activity.cost_micros` (micro-dollars). Monthly = calendar month in **UTC**; format
    reset dates in UTC. Every model call logs its real cost (`responseCostMicros` / `messageCostMicros`) even if the result isn't saved.
  - **Trust score** (`lib/agent-trust.ts`): inherent risk per permission + penalties for failed checks (incl. one check
    per enabled uploaded skill, failed at its worst scan finding). Saving a change to instructions, permissions or
    budget, or switching a skill (`refreshRuleTrust`), re-runs the rule scan, so the stored score always matches the
    saved config.
    **Scan again** scores the saved config (disabled while the dialog is dirty) and adds an AI review when a provider is configured.
  - **Run** refuses when the analyst is paused or over budget (`checkAgentCanRun`) and logs `task_assigned`.
  - **SwitchAgent scans** (`lib/switch-trust.ts`, [`docs/switch-trust.md`](docs/switch-trust.md)): with a Switch account
    connected (Settings → `#switch`), the score comes from Switch. Connecting (and saving a provider key) scans every
    agent; **SwitchAgent Scan** in the dialog scans one, on demand. Always **one** evaluation per agent (the fastest
    built-in, saved on the connection), never the catalog. Work runs on Cloudhike jobs, never in the user's request;
    the page polls with `TrustScanWatcher` while a scan is pending. Weekly re-scans (`switch-weekly-scans`, toggle in
    Settings) and the agent's budget as its Switch cost cap (set on register/scan and on budget change; best effort). Saving a config keeps a Switch report (flagged as
    older than the change) instead of overwriting it with the rule scan. Never copy test conversations: they're
    attacker-written.
  - **Max turns** (`agents.max_turns`, null = role default from `AGENT_ROLES`) caps model turns per pipeline stage.
  - **Working** status = a `running` run is in that agent's phase and its stage hasn't ended this round
    (`workingAgents`, `getWorkingAgents`), not "has assigned cards". Reviewer and Security can both be working.
  - Server actions call `revalidatePath` so cards, stats and open overlays show fresh data; dialog form state survives.
- **Live process** (`components/ai-team/live-process.tsx`): six steps, one per phase. Nothing in flight → "Inactive"
  and every step idle with what it does; otherwise one block per queued/running run. Rules:
  - Data comes only from the live poll: `LiveTeamProvider` polls `getTeamStatusAction`
    (`app/dashboard/[workspaceId]/actions.ts`) every 5 s while someone works, 15 s otherwise, only while the tab is
    visible. It reads `getTeamOverview`, which never writes; its `runs` are `LiveRun`s.
  - The mapping is pure and tested (`liveProcessSteps` in `lib/live-process.ts`); the component only renders it.
  - Actions show tool names and targets from `agent_run_steps` (labels from `TOOL_LABEL`, shared with the agent log),
    never tool content. A two-agent step labels each action with its agent.
  - Motion: the working marker spins and the face ring pulses only with `motion-safe:`; chips and markers carry text
    (screen readers get the step state), never color alone.
- **Agent pipeline** (`lib/inngest/agent-run.ts` + `lib/agent-pipeline.ts`): Analyst (Analysis) → Developer (In
  Development, branch `agent/<key>-<slug>`, PR) → Reviewer and Security in parallel (In Review) → Lead (approval, still
  In Review) → Tester (Testing) → merge (Done). Rules:
  - **Phase vs stage**: a phase (`RUN_STAGES`, stored in `agent_runs.stage`, shown on the board and the live process)
    can hold two agents; a stage (`AGENT_STAGES`) is one agent's tool loop. The agent log (`agent_run_steps.stage`), the
    Claude conversation key (`<stage>:<round>`) and Inngest step ids use the stage, so parallel work never collides.
    Only a phase's first agent moves and holds the card (`placeTask`).
  - **Parallel review**: `Promise.all` of two `runStage` calls; each turn is still its own step. `beginStage` marks the
    run running only while it's still active (`markStageRunning`), and `runStageTurn` stops when the run isn't
    active any more, so a stop in one stage ends the other at its next turn. `stopRun` takes the stage that stopped;
    a second stop only closes that stage's log and activity (one notification).
  - Each stage is a tool loop of at most the agent's max turns, **one Inngest step per turn**; the last turn forces the
    stage's finish tool (strict JSON schema). Step bodies reload state from the DB — never keep state in closures.
  - **Permissions are enforced as tools** (`toolsFor` in `lib/agent-tools.ts`). Adding a capability = a tool gated by a
    permission there, not a prompt instruction. ("Skills" are knowledge, not capabilities: see Agent skills below.) Agents never write `.github/workflows/`, `.env*` (except `.env.example`) or
    `.git/`; manifests need `deps.manage`. Tool output is untrusted data — the stage protocol in `systemPrompt` says so.
  - **One company per workspace, one model per agent** (Settings → `#ai`, `workspaces.ai_provider`). The configure
    dialog lists only that provider's models (`modelsFor`), and `saveAgentAction` rejects a model from the other one.
    `agents.model` is the active model; `agents.provider_models` remembers the agent's model on each provider, so
    `switchAgentsToProvider` restores earlier choices (first time: `EQUIVALENT_MODEL`, via `agentModelFor`). Read the
    active model with `activeAgentModel(row, provider)`. Role defaults are per provider (`defaults.models`: Sol/Sonnet,
    the Lead included; Tester Luna/Haiku). Config AI (drafting, trust reviews) uses the workspace provider, or the other one if only it has
    a key (`configAI`). Run refuses up front when any agent's model has no key (`pipelineModelProblem`).
  - **Models and providers**: `AGENT_MODELS` (`lib/agent-config.ts`) lists OpenAI and Claude models with their `provider`
    and prices. The model is pinned per stage in `LoopState` (a change on the AI Team page applies from the next stage).
    Claude's conversation is stored in `agent_run_messages` (append-only, written at fixed positions so a retried step
    overwrites itself); thinking blocks go back unchanged. Claude 5.5 models reject forced tool choice, so the last turn
    is a mid-conversation system message instead. Opus/Sonnet 5.5 use refusal `fallbacks: "default"`.
  - Pause and budget are re-checked every turn; each turn adds its cost to the stage's `task_run` activity row and to
    `agent_runs.cost_micros`.
  - **The Lead decides**: its `request_changes` (or test `fail`) → back to the Developer on the same branch/PR, at most
    `MAX_REWORK_ROUNDS`. The Reviewer's verdict and Security's report feed the Lead; neither sends work back on its own.
    The Lead's decision sets `pull_requests.review_status` and `risk`.
  - **Risk**: `recordApproval` raises the Lead's rating to `riskFloor` (Security's worst finding; dependency, schema,
    auth or CI paths; more than 10 files or 400 lines, measured on GitHub). The Lead may rate higher, never lower.
    New sensitive areas go in `SENSITIVE_PATHS` with a test.
  - Merge mode and pickup mode come from `workspaces.agent_merge_mode` (`MERGE_MODES`: manual, auto_low_risk, auto)
    / `agent_auto_pickup` (Settings → `#agents`); `mergeDecision(mode, risk)` decides (the old
    `agent_auto_merge` column was dropped in migration 0007). `mergeAgentPullRequest` is the only merge path (auto and manual): mergeable
    + CI green, otherwise the Tester files one follow-up card per PR (`createAgentTask`, plus a GitHub issue with
    `issues.create`).
  - **Agent log**: every turn's tool calls go to `agent_run_steps` (`saveRunSteps`) and every stage's end too
    (`saveStageEnd`: result, or the stop reason via `stopRun`). Positions are fixed (stage, round, turn, seq), so retries
    rewrite instead of duplicating. Never log tool *content* (file reads, diffs): only targets and short confirmations
    or errors (`toolStep`). The log sheet shows parallel stages as separate blocks, both live at once.
  - **Simulated mode** (`AGENTS_SIMULATED=true`) scripts every stage, including Security (pass) and the Lead (approve,
    low risk), so the whole flow runs without a model.
  - **Out of credit** (`isOpenAIOutOfCredit` / `isAnthropicOutOfCredit`) is not a generic failure: the run stops with
    `agent_runs.failure = { kind: "out_of_credit", provider }` and the board offers switch-and-retry
    (`switchProviderAndRetryAction`). With `workspaces.ai_auto_failover` and the other company's key, `runStageTurn`
    switches the team and returns `restart` instead: the stage starts over, at most once per stage.
  - **Notifications**: `notify()` at the moments that need the owner (PR ready, merged, merge blocked, needs info, run
    failed, out of credit, provider switched). A new failure path goes through `stopRun` so it gets logged and notified.
  - The pipeline moves cards with `placeTask` (top of the column, bottom for Done). It owns column + assignee while a
    run is active; users can still drag, and the next stage moves the card again.
- **Agent skills** (`/dashboard/[id]/settings/skills`, AI Team → Configure → Skills): knowledge packs in the Agent Skills format
  (SKILL.md frontmatter `name` + `description`, markdown body, optional reference `.md`). Not permissions. Rules:
  - **Never executed.** Agents only search and read them (`search_skill`, `read_skill`, read-only, any stage, only the
    agent's enabled skills, validated paths). A skill can never add a tool or a permission. Only `.md`/`.txt` are kept.
  - **Untrusted-content protocol**: the operating protocol overrides skills; `skillsPromptBlock` frames them as
    reference material and maps "run this CLI" to the two tools. Log skill calls by target only (`toolStep`).
  - **Built-ins are vendored by pull request**: edit `agent-skills/sources.json` (pinned commit SHA, license, type, load,
    default roles, `usage` note when upstream assumes a shell), run `npm run skills:sync`, review the diff. Never fetch
    skills at runtime, never hand-edit `agent-skills/<slug>/` or `catalog.json`. A unit test checks the catalog
    against the files with the app's own parser. The folder ships with the functions that import
    `lib/builtin-skills.ts` (plus `outputFileTracingIncludes` for `/api/inngest` and `/api/switch-trust/**`).
  - **Uploads**: zip ≤ 5 MB, text ≤ 3 MB, ≤ 300 files; SKILL.md at the root or one folder deep; no absolute paths,
    `..`, symlinks, ZIP64 or encryption; names lowercase/digits/hyphens ≤ 64, description ≤ 1024; an `always` body
    ≤ 8 KB. Inspect → confirm → install: rules first (critical blocks before any model call), then one AI review
    (`reviewSkillWithAI`, cost logged on the Security agent as a scan), a sealed token carries the version and AI
    findings to the install, which re-reads the file and re-runs the rules.
  - **Classification** from frontmatter `metadata` (`techteam-type`, `techteam-load`, `techteam-roles`,
    `techteam-requires`), else the AI review's proposal; the user confirms.
  - **Assignments**: `agent_skill_assignments.enabled`; switching off keeps the row so `ensureBuiltinSkills` never
    re-enables it. Every change logs on the agent and rescans its trust (`skill-install.ts`). Built-ins can't be
    deleted. `agents.skills` is the **permissions** column (`permissions` in Drizzle): don't rename it while the dev
    database is shared with older branches.
- **Pull Requests** (`/dashboard/[id]/pull-requests`): the page calls `refreshOpenPullRequests` (picks up merges/closes
  made on GitHub), then renders `PullRequestsView`: approval (the Lead), tests and risk chips. **Merge** only for PRs
  the Lead approved and tests passed.
- **Activity feed** (`lib/activity.ts`): `agent_activity` rows, cards people created (`tasks.created_by_id`) and
  people's card moves, edits and removals (`task_events`, logged by the board actions after the change is saved),
  merged newest first. The Activity page shows every kind (`?show=` grows the list in steps of 50, up to 500); the
  Overview shows only `WORK_ACTIVITY_KINDS`. Icons per kind live in `ACTIVITY_KIND` (`components/dashboard/activity-kind.tsx`),
  shared with the agent activity drawer. A new activity kind needs an entry there.
- **Empty states:** every list on the Overview and the Activity page has one (`SurfaceEmpty` inside a surface that keeps
  its header, `SectionEmpty` for a whole page). Never ship fixture data; mark a placeholder with `⚠️ PLACEHOLDER`.
- **Horizontal scroll areas must be `relative`.** Absolutely positioned descendants (every `sr-only` label) are only
  clipped by an `overflow` container that is positioned; otherwise they escape and widen the page on mobile.
  `SidebarInset` also carries `min-w-0` so wide content can't stretch the panel.
- **Grid children with truncated text need `min-w-0`.** Grid/flex items default to `min-width: auto`, so a
  `truncate` line inside a card widens the track and the page scrolls sideways on mobile. Every card component
  puts `min-w-0` on its root.
- **Presentational split:** when a page has non-trivial markup, keep it in a `components/<feature>/*-view.tsx`
  component that takes plain props (see `OverviewView`); the page only loads data. This keeps pages previewable.
- **Other signed-in pages** (`/workspaces*`): `min-h-svh bg-canvas` → `<AppHeader user={user} />` →
  `<main className="mx-auto max-w-2xl px-6 py-10">`, content in `surface` cards.
- **Header actions:** round bordered icon buttons (`size-9 rounded-full border bg-card`), hover tints the border. The
  GitHub button widens into a pill with the repository name from `sm` up. The account menu lives only in the header
  avatar (`HeaderUserMenu`); the sidebar has no footer menu.
- **Menus:** `DropdownMenu*` from `components/ui/dropdown-menu` (Base UI). Navigation items use
  `<DropdownMenuItem render={<Link href=… />}>`; `DropdownMenuLabel` must sit inside a `DropdownMenuGroup`.
  Triggers styled as other components use `render` (`<DropdownMenuTrigger render={<SidebarMenuButton />}>`).
- **Spacing:** 4-px grid. Use `gap-*` on flex/grid, not margins between siblings. Typical: `gap-1.5` eyebrow/title/
  description, `gap-4` between cards in a grid, `gap-8` between page sections, `p-5` tiles, `p-6` cards, `p-6 sm:p-8` hero.
- **Radius:** `--radius` is 0.75rem: `rounded-lg` controls and tiles, `rounded-xl` cards (`surface`), `rounded-full` avatars,
  chips and header buttons.
- **Buttons:** `Button` from `components/ui/button` (flat — no shadows). Form CTAs `h-10`, toolbar/secondary `h-9`.
  One primary (`default`) per view; others `outline`/`ghost`. Links styled as buttons use `buttonVariants()` on
  `<Link>`/`<a>`. On a `surface-brand` the CTA is a white button with `text-brand`. Pending state: `disabled` +
  `<Spinner />` + a verb in progress ("Creating workspace…").
- **Forms:** `Field`, `FieldLabel`, `FieldError` from `components/ui/field`; inputs `h-10`; form-level errors with `FormMessage` (`components/auth/form-parts`).
- **Selection controls:** custom-styled choices (icon grid, repo list) are native `<input type="radio" className="peer sr-only">` inside a `<label>`, styled with `peer-checked:` / `peer-focus-visible:`. This keeps keyboard and screen-reader support for free.
- **Loading:** stream with `<Suspense>` and a `Skeleton` that matches the final layout. **Empty states:** `<SectionEmpty>` —
  a `surface` with a fading dot grid, a ringed icon tile, one sentence and at most one action.
- **Icons:** lucide at `size-4` inline, `size-5` inside `icon-tile`. Decorative icons get `aria-hidden` (lucide default); meaningful icon-only buttons need an `aria-label` or `sr-only` text.
- **Workspace identity:** always render with `<WorkspaceAvatar icon logoSrc size />`; get `logoSrc` from `workspaceLogoSrc(workspace)`.
- **Motion:** subtle only — `transition-colors`, small `translate-x-0.5` on arrows, `animate-in fade-in`. No lifts or bounces.
- **Responsive:** mobile-first; check 375 px width. Stack horizontal groups with `flex-col sm:flex-row`.
- **Accessibility:** every input has a label (visually hidden with `sr-only` if needed); focus must stay visible (`ring-ring/50`); color is never the only signal (pair with icon or text).
- **`components/ui/`** is generated shadcn code. Restyle it through tokens in `globals.css` first; edit a primitive only
  for a design-system-wide visual change (keep its API), and note it here. Current edits: `button.tsx` (outline uses `bg-card`).

## 7. Environment variables

See `.env.example` for the full list with comments. Feature-specific:

| Variable | Needed for |
| --- | --- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Connecting GitHub on `/workspaces/new`. OAuth App callback: `<NEXT_PUBLIC_APP_URL>/api/github/callback`. |
| `TOKEN_ENCRYPTION_KEY` | Encrypting GitHub tokens and AI provider keys (`openssl rand -base64 32`). Rotating it forces every user to reconnect GitHub and re-enter their AI keys. |
| `S3_*` | Workspace logo uploads. Without them the upload button is disabled; icons still work. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Optional server-wide fallback for workspaces that haven't saved their own key in Settings → AI providers. |
| `JOBS_API_URL`, `JOBS_API_KEY` | Cloudhike Jobs: runs SwitchAgent scans in the background. |
| `PUBLIC_APP_URL` | The app's internet-reachable URL for callbacks (jobs, Switch evaluations); defaults to `NEXT_PUBLIC_APP_URL`. A tunnel in local dev. |
| `SWITCH_AGENT_AI_API_KEY` | Optional server-wide Switch Trust key (Editor role) for workspaces that connect without their own. |
| `AGENTS_SIMULATED` | Local testing: `true` runs the pipeline with scripted agents (`lib/agent-simulated.ts`) — no model calls or spend, but real GitHub work (branch, `agent-simulations/<branch>.md`, PR). |
