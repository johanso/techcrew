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
sign in with GitHub ─▶ /workspaces ──(no workspaces)──▶ /workspaces/new ──Next──▶ /dashboard/<id>
                         │                                  │
                         └──(pick one)──▶ /dashboard/<id>   ├─ name
                                                            ├─ icon or uploaded logo
                                                            └─ select repository (GitHub is already connected by signing in)
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
| Database | PostgreSQL + Drizzle ORM | Schema in `db/schema.ts`; SQL migrations in `drizzle/` (`db:generate` → `db:migrate`). `DATABASE_URL` unset: an embedded Postgres (`embedded-postgres`, `scripts/local-db.mjs`, started by `npm run dev`). |
| Auth | GitHub OAuth device flow (or a personal access token), no remote auth service | Sign-in is also repository access. Stateless signed cookie `tt_session` (`lib/session.ts`, secret in the data dir). The app listens on `127.0.0.1` only and `proxy.ts` refuses foreign `Host` headers. |
| GitHub | OAuth App, public client id, **no client secret** (`repo read:user`) | `GITHUB_CLIENT_ID` overrides the shipped default (`lib/github-client-id.ts`); tokens are AES-256-GCM encrypted, key in `TOKEN_ENCRYPTION_KEY` or `<data dir>/encryption.key`. |
| File storage | Local disk (`TECHTEAM_DATA_DIR`, default `~/.techteam/data/files`) | Never public; served through ownership-checked routes. |
| Jobs | Inngest, always the local Dev Server (pinned `inngest-cli@1.53.0`, bound to `127.0.0.1`) | `lib/inngest/*`, `app/api/inngest`: `agent-task-run`, `agent-auto-pickup`, `run-sweep`, `preview-sweep`, `memory-librarian` (+ `memory-librarian-auto`). No Inngest Cloud. |
| Operation | `npm run doctor`, `npm run start:local`, `npm run backup` / `restore` | `scripts/` + `lib/doctor`, `lib/backup` (plain `.mjs`, tested). Backups hold no secrets. |
| Sandbox (optional) | Docker: this computer's own (local mode) or a prepared host with gVisor (remote mode, `SANDBOX_DOCKER_HOST`, `deploy/setup.sh`) | `lib/sandbox/mode.ts` picks the mode; local needs `npm run sandbox:setup` once. docs/sandbox.md. |
| AI | OpenAI (`openai` SDK, Responses API), Anthropic (`@anthropic-ai/sdk`, Messages API) and OpenRouter (`openai` SDK, Chat Completions: Google, DeepSeek, Z.ai, xAI, Moonshot models); locally, Claude models can run on the owner's plan through Claude Code (`lib/cli/`, docs/cli-agents.md) | `lib/openai.ts`, `lib/anthropic.ts`, `lib/openrouter.ts`; each agent's model picks the provider, the computer picks the route (plan or key). Optional — features degrade without keys. |
| Quality | ESLint 9 (flat config, `eslint-config-next`) + Vitest 4 | `npm run check` = typegen + tsc + lint + unit tests. CI: `.github/workflows/ci.yml`. |

## 3. Commands

```bash
npm run dev          # embedded database + app on http://127.0.0.1:3000 + Inngest Dev Server, one terminal (dev:app = only the app)
npm run build        # production build — must pass before you finish
npm run check        # next typegen + tsc + eslint + vitest — must pass before you finish (CI runs it + build)
npm test             # unit tests (Vitest); npm run test:watch while working
npm run lint         # ESLint
npm run db:generate  # after changing db/schema.ts: write the SQL migration into drizzle/ (read it, commit it)
npm run db:migrate   # apply pending migrations
npm run db:baseline  # once, for a database created with db:push before migrations: mark them applied
npm run db:studio    # inspect data
npm run db:local     # only the embedded Postgres (npm run dev starts it when DATABASE_URL is unset)
npm run backup       # one .tar.gz of the database and files, no secrets (-- --out <file>); npm run restore -- <file> into an empty database
npm run storage:import-s3  # one time: copy files from the old S3 bucket (needs the old S3_* variables)
npm run inngest:dev  # only the Inngest Dev Server (pinned version; npm run dev already starts it) — needed by Run, auto pickup, auto-merge
npm run start:local  # stable mode: production build (rebuilds when the code changed) + database + pinned Inngest, one terminal
npm run smoke -- --repo <owner/name>  # one simulated card through the whole pipeline on a throwaway repo, own stack and ports; touches GitHub, not part of check (docs/testing.md#smoke-test)
npm run doctor       # checks Node, git, ports, database, secrets, GitHub, Claude Code and .env; `--json`; exit 1 only on a ✗
npx next typegen     # regenerate PageProps / RouteContext types after adding routes
npx shadcn add <c>   # add a shadcn component into components/ui
npm run sandbox:setup  # local sandbox: download the sandbox image, build the browser image (-- --check only reports)
npm run skills:sync  # re-vendor the built-in agent skills at their pinned refs (-- --update <slug> to bump); commit the diff
```

## 4. Folder structure

```
app/
  (auth)/                 Sign-in (device flow + personal-token form) and sign-in/adopt (confirm adopting existing data).
                          actions.ts = auth server actions (start/poll/cancel, token sign-in, adopt, signOut).
  api/
    workspaces/[id]/logo/     Streams a workspace logo from local storage to its owner.
    workspaces/[id]/references/[referenceId]/  Streams a card reference from local storage to the workspace owner (sandboxed).
    inngest/                  Inngest handler (serves the agent pipeline and auto pickup).
    mcp/runs/[runId]/         TechTeam's MCP endpoint for a CLI agent's stage (local only; per-run bearer): lists and
                              calls the stage's tools (lib/cli/stage-mcp.ts).
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
      board/ ai-team/ brain/ pull-requests/ metrics/ activity/   One page.tsx per sidebar section.
      ai-team/actions.ts  saveAgentAction, scanAgentAction, generateAgentAction
                          (auth + validation).
      board/actions.ts    createCardAction, updateCardAction, moveCardsAction, removeCardAction, runCardAction,
                          answerCardAction (answer the analyst + run again), stopCardAction, mergeCardAction, switchProviderAndRetryAction (out of credit), getRunLogAction
                          (agent log), syncIssuesAction (also refreshes agent PRs), listCardReferencesAction /
                          uploadCardReferenceAction (one file per call) / addCardLinkAction (captures a link) /
                          removeCardReferenceAction (auth + validation).
      pull-requests/actions.ts  mergePullRequestAction (manual merge, via mergeManually).
      brain/actions.ts    saveNoteAction (create/edit, owner's place only), setNoteStatusAction, deleteNoteAction,
                          saveMemoryModeAction; signals: answerRejectionAction, dismissRejectionAction, rememberAction
                          (also used by the board and Pull Requests), deleteSignalAction; librarian:
                          runLibrarianAction, acceptProposalAction, editProposalAction, rejectProposalAction,
                          openMemoryPullRequestAction, refreshMemoryPullRequestsAction (auth + validation + scan).
      settings/           Your account: GitHub identity + Sign out (#account), AI (#ai: "Plans on this computer" when running locally —
                          Claude Code switch, sign-in, confirmed account, plan-limit choice — then API keys for every
                          project, then Models (updated when, Refresh models), then "This workspace only": automatic
                          switch + fallback order), API spending
                          and plan usage this month across projects (#usage). This workspace: workspace (#workspace), agent automation (#agents), Sandbox
                          (#sandbox; one line with the reason and the fix when the sandbox can't run) and an Agent skills card (#skills) linking to
                          skills/page.tsx (the library on its own page). actions.ts: automation, saveSandboxAction /
                          checkSandboxAction (Test the sandbox),
                          auto failover toggle, saveFallbackOrderAction (the order companies are tried in), save/remove provider key, refreshModelsAction,
                          inspectSkillAction / installSkillAction (upload, two steps), saveSkillAssignmentsAction,
                          deleteSkillAction.
  globals.css             THE theme: palette, semantic tokens, Tailwind mapping.
  layout.tsx              Root layout; loads Plus Jakarta Sans, ThemeProvider.
  page.tsx                `/`: redirects to /dashboard (signed in) or /sign-in. No landing page yet.
components/
  ui/                     shadcn primitives. Generated — do not hand-edit; restyle via tokens.
  auth/                   Sign-in UI: github-sign-in (device-flow states, PersonalTokenForm), brand icons, FormMessage.
  workspace/              Workspace UI (avatar, create form, appearance + repo pickers, draft storage).
  board/                  Kanban: kanban-board (state + DndContext), board-column, board-card, card-dialog (create + edit),
                          card-references (the dialog's References section: upload, add a link, list, remove),
                          board-toolbar (search + type tabs), board-filters (pure matching logic),
                          use-github-sync (polling hook), github-sync-controls (Refresh button, sync notice),
                          issue-meta (type/priority/column colors + PriorityBadge, IssueTypePill, DueDate — reuse everywhere),
                          agent-run-status (the run line on a card: stage, needs info, stopped, out of credit, ready to
                          merge), run-log-sheet (agent log panel), credit-notice (out of credit: switch and retry),
                          answer-dialog (answer the analyst's question).
  pull-requests/          pull-requests-view (PR list, verdict chips), merge-button.
  activity/               activity-timeline (Activity page: events grouped by day, Show older).
  metrics/                metrics-view (Metrics page markup: period tabs, stat tiles, bar lists, recent runs), bar-list
                          (ranked one-hue bars with printed values).
  settings/               agent-automation-form (task pickup + merge mode), auto-failover-toggle, cli-plan-settings (Plans on
                          this computer: Claude Code),
                          provider-key-form
                          (account or workspace scope; masked key + show/hide), model-catalog-status (Models updated ·
                          Refresh models), account-spend (spending across projects),
                          sandbox-section (the Sandbox card: asks the status, streamed; one line with the reason when
                          unavailable), sandbox-form (Settings → Sandbox: switch, commands, install scripts (local),
                          previews, Test the sandbox),
                          option-cards (radio
                          cards shared by the settings forms).
  ai-team/                AI Team: ai-team-view (page markup), agent-roster (cards + open overlay state), agent-card
                          (live working state), agent-config-dialog (form + PermissionPicker + Draft with AI), trust-panel,
                          spending-panel, skills-panel (only the agent's skills with switches + "Add a skill" search, setAgentSkillAction), agent-activity-sheet, agent-visuals (AgentPortrait, AgentStatusBadge, BudgetMeter,
                          TrustRing), agent-face (the face image + initial fallback), live-process (the six steps of each
                          card in flight), live-team (LiveTeamProvider + useLiveTeam: one poll of getTeamStatusAction; also
                          keeps the Overview's AI team card live).
  skills/                 Agent skills UI: skill-library (Settings → Agent skills page: search + agent filter, list,
                          Assign, New version, Delete), skill-filters (pure
                          search/filter, tested), skill-upload-button (the dialog), skill-upload (choose → inspect → confirm → install → Done, in a
                          dialog), skill-badges (SkillBadges, SkillScanChip,
                          SkillAgents, agentOf), skill-findings, agent-checkboxes ("Assign to" the six agents).
  brain/                  The Brain page: brain-view (markup; the page only loads data), repo-notes (mode repo: read-only
                          notes + SkippedList), note-library (notes in the database: create/edit/switch off/delete),
                          note-editor (NoteDialog: the form, scan findings), note-row, block-preview ("What agents get"),
                          memory-mode-form (Settings: repo / local / off, learn automatically), signal-activity (Activity:
                          the signals) + signal-delete-button + signal-icons, rejection-prompt (the "Why was this
                          rejected?" strip and dialog, on board cards and Pull Requests), remember-dialog ("Remember this",
                          card menu and agent log), signal-form-parts (radio chips, refused findings), librarian-card
                          (Learn now, first memory, last run), proposal-inbox + proposal-card + proposal-edit-dialog
                          (accept / reject / the memory pull request), check-row.
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
  session.ts              Stateless sessions: seal/unseal (`<payload>.<expiresAtMs>.<hmac>`), signSession / verifySession,
                          startSession / clearSessionCookie / getSessionUserId, sealed short-lived cookies
                          (writeSealedCookie / readSealedCookie, optionally encrypted). session-config.ts: cookie names
                          (`tt_session`, `tt_login`, `tt_adopt`) and lifetimes, pure (proxy.ts imports it).
  secrets.ts              getEncryptionKey (TOKEN_ENCRYPTION_KEY, else `<data dir>/encryption.key`), getSessionSecret
                          (`<data dir>/session.secret`); both generated on first use, owner-only. Pure parts tested.
  device-flow.ts          Pure, injected fetch: requestDeviceCode, pollDeviceFlow (interval, slow_down, expired, denied,
                          disabled). No client secret. sign-in.ts: the server side of sign-in (login cookie, completeSignIn,
                          personal token, adoption answer).
  user-identity.ts        Pure: resolveUser (which user a GitHub id is: by id, by saved connection, adopt the only user,
                          create), noreplyEmail. local-user.ts: the database side under an advisory lock.
  host-guard.ts           Pure: isAllowedHost (localhost / 127.0.0.1 / [::1] / NEXT_PUBLIC_APP_URL's host); proxy.ts uses it.
  safe-redirect.ts        isSafeRedirectPath.
  github-client-id.ts     DEFAULT_GITHUB_CLIENT_ID + resolveGithubClientId (GITHUB_CLIENT_ID wins).
  current-user.ts         getCurrentUser() / requireUser(returnTo): verifies the session cookie, loads the `users` row.
  github.ts               GitHub REST + connection persistence (saveGithubConnection is the only token writer); commitFiles (several files, one commit); the
                          merge's Git Data calls (mergeIntoBranch, getTreeEntries, getBlob / createBlob, commitTree).
  crypto.ts               encrypt / decrypt for secrets at rest (key from secrets.ts).
  ai-keys.ts              AI provider keys: getAIKeys (owner's account key, else env; keyInUse),
                          getProviderKeyViews (masked), verifyProviderKey, saveProviderKey / removeProviderKey (the
                          account's keys, encrypted).
  storage.ts              Local files under TECHTEAM_DATA_DIR/files (logos, screenshots, card references): uploads/reads/deletes by validated relative key, atomic writes, logo limits.
  workspaces.ts           Workspace queries (always scoped by owner) + getDashboardContext().
  overview.ts             getOverviewData(): stats + upcoming tasks from getBoardData, recent work activity.
  activity.ts             getActivityFeed(): agent_activity + cards people created + task_events, newest first;
                          WORK_ACTIVITY_KINDS.
  agent-config.ts         AI Team vocabulary shared by server + client: roles + defaults (a tier per role; roleDefaultModel),
                          PERMISSIONS, PROVIDER_IDS / PROVIDERS, AgentModelId (a string: models are catalog data),
                          agentModelFor, fallbackProvider, limits.
  model-catalog-config.ts Pure, client-safe: the model catalog's rules (docs/model-catalog-plan.md). Route ids both ways
                          (routeOf / openRouterIdOf / modelProvider), parseCatalogResponse (eligible models of OpenRouter's
                          /models), buildCatalog (current = newest per family within CURRENT_WINDOW_DAYS, tiers by output
                          price), closestModel / pickInTier, pickerModels / pickerCatalog, catalogEntries (stored, else
                          seed). Tested on lib/__fixtures__/openrouter-models.json (a trimmed real response).
  model-catalog.ts        The catalog in `model_catalog`: getModelCatalog (cached a minute, seed fallback), catalogModel,
                          refreshModelCatalog (fetch, upsert, mark unlisted; never deletes), refreshModelCatalogIfStale.
  model-seed.ts           SEED_ENTRIES / SEED_CATALOG: the pre-catalog models, used only before the first fetch and to name
                          or price a model no stored row knows. Never extended.
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
  memory-config.ts        The Brain's vocabulary, pure and client-safe (docs/brain-plan.md): modes, types, limits, MemoryNote,
                          parseNoteFile / serializeNote / validateNote, visibleNotes (THE rule for which notes an agent
                          may see), globMatches + rankNotes (lexical, path boost), buildMemoryBlock / memoryPromptBlock
                          (the byte-stable Memory block). Tested.
  memory-scan.ts          Pure: scanMemoryNote (deterministic security rules for a note; critical findings block), blocksNote.
  memory-loader.ts        Pure apart from a reader: loadRepoNotes (.techteam/memory/ through a RepoReader: skipped files with
                          reasons), repoMemoryCache (~60 s, re-reads when the branch head moved). Tested on a fake repository.
  memory.ts               Server: loadMemory / loadAgentMemory (repo files, rows, the owner's notes; scan again at load;
                          visibleNotes), searchMemory / readMemory (the two tools), owner CRUD for rows (create/update/
                          setMemoryNoteStatus/delete), loadOwnerNotes, getMemoryMode.
  sandbox/                Agent sandboxes (docs/sandbox.md). config.ts: pure, client-safe (commands, detectCommands,
                          parseSandboxCommand, sandboxReport, outputTail, the install network's constants,
                          bridgeNetworkProblem). mode.ts: pure, client-safe (SandboxMode remote/local, resolveSandboxStatus,
                          parseDockerInfo, unavailableMessage). docker-args.ts: pure, EVERY docker argument list in both
                          modes (tested for the forbidden flags and mounts); docker-env.ts: the CLI's environment;
                          install-command.ts: localInstallCommand (--ignore-scripts); engine.mjs, setup-config.mjs
                          (plain node: doctor and `npm run sandbox:setup`). cli.ts: sandboxHost, dockerMode, dockerCli.
                          status.ts: getSandboxStatus (docker info + images, cached 15 s). docker.ts: runInSandbox
                          (prepare on the install network, command without network, gVisor on a remote host + limits),
                          ensureBridgeNetwork (install and capture networks), local preview forwarder,
                          addPackageInSandbox, removeSandbox, hourly sweep. index.ts: sandboxAvailable (async),
                          detectRepoCommands, runRepoCommand (one volume per run), addRepoDependency, removeRunSandbox,
                          checkSandbox. dependency-config.ts: pure (add_dependency: parseDependencyArgs, dependencyPlan,
                          addDependencyCommand, dependencyChange, dependencyReport).
                          preview.ts: PR previews (startRunPreview / pollRunPreview / stopRunPreview /
                          stopPullRequestPreviews / sweepPreviews, getRunPreviewEndpoint; state in agent_runs.preview).
                          browser.ts: browsePreview (the Tester's headless Chromium on the preview's network);
                          browser-config.ts: pure (parseBrowseArgs, browseReport, PREVIEW_STAGES, viewports + color
                          schemes, closestViewport). capture.ts: captureLink (a link reference: the same image with
                          internet through a checking proxy, on the techteam-capture network); capture-config.ts: pure
                          (parseCaptureUrl, parseCaptureOutput, formatCaptureOutline). Tested.
  cli-agents-config.ts    Agents on the owner's plans, pure and client-safe: CLI_KINDS / AGENT_ROUTES / CLI_META,
                          cliAgentsAllowed (local URL, no hosting marker, AGENTS_LOCAL_CLI kill switch), parseCliAuth,
                          accountMatches, planIncludesModel, resolveRoute, PLAN_LIMIT_POLICIES + planLimitAction,
                          RunWaiting, planUsageSummary, ClaudePlanView. Tested.
  cli/                    Local CLIs (docs/cli-agents.md). index.ts: CLI home (~/.techteam/cli), machine id + state.json,
                          detectClaude (cached 60 s), childEnv (allowlist), sign in/out, cli_settings,
                          claudeMachineState, run working folders. claude-config.ts: pure claudeChunkArgs, stream-json
                          reader, classifyClaudeChunk (tested). claude-run.ts: runClaudeChunk, MCP bearer. stage-mcp.ts:
                          the stage's tools as an MCP registry. plan-view.ts: Settings' view.
  mcp-protocol.ts         Pure: a minimal stateless MCP server (initialize, ping, tools/list, tools/call), mcpToolsFrom.
  backup/                 Backup and restore, plain .mjs (run by node in scripts/, imported by Vitest; they import
                          db/schema.ts, which Node 22.18+ type-strips). registry.mjs: EXCLUDED_TABLES, SECRET_COLUMNS,
                          REVIEWED_SAFE_COLUMNS, the schema walk (exportTables). **Data rule: a new table or column that
                          holds a token, key or secret goes in those registries (registry.test.ts fails otherwise), and a
                          new column type needs a `columnKind`.** order.mjs (restore order by foreign keys, cycles
                          broken at nullable columns), rows.mjs (select/insert SQL, value checks), manifest.mjs,
                          archive-paths.mjs + tar.mjs (system `tar`, archive is untrusted), export.mjs (read-only
                          snapshot, cursor), import.mjs (one transaction, never into a non-empty database), adoption.mjs
                          (github_user_id for sign-in), connection.mjs. s3-source.mjs and storage-key.mjs are shared with
                          import-s3 and lib/storage.ts.
  doctor/                 Plain .mjs behind `npm run doctor`: checks.mjs (the checks, over injectable probes), probes.mjs (real
                          probes: ports, database, GitHub, Claude Code), env-hygiene.mjs (obsolete `.env` names, names only),
                          claude.mjs, report.mjs. Never prints a secret or a value from `.env`. Tested.
  local-db-config.mjs     The embedded Postgres' settings (data dir, port, secret, ready file); shared by db/index.ts,
                          drizzle.config.ts and scripts/local-db.mjs. local-stack-config.mjs: start:local's ports, the
                          pinned Inngest version and the build decision.
  db-errors.ts            Pure: isUniqueViolation (createRun's one-run-per-card guard).
  memory-signals.ts       Brain signals (docs/brain-plan.md part B), pure and client-safe: kinds, rejection reasons,
                          rework causes, limits, the builders (capped, scanned, dedupe key, trusted flag), the Lead's
                          lessons (LESSONS_SCHEMA, parseLessons), shouldAskWhyRejected, signalsToPrune. Tested.
  memory-signals-store.ts Writing and reading them (never throws): record*Signal, askWhyRejected / answerRejection /
                          dismissRejection / getPendingRejections, rememberNote, listSignals, deleteSignal. Tested.
  memory-proposals.ts     The librarian's vocabulary, pure and client-safe (docs/brain-plan.md part C): proposal kinds,
                          statuses, limits, learnDecision, deliveryOf, parseLibrarianRequest, currentLibrarianState.
  memory-hash.ts          noteHash, noteVersion, proposalHash (node:crypto).
  librarian.ts            Pure: what the model sees (selectSignals / selectNotes, prompts, data block), the strict
                          schemas, validateLearning / validateBootstrap / checkProposalNote, and rememberedProposals (the
                          only global proposals: the owner's words, without a model). Tested.
  librarian-simulated.ts  AGENTS_SIMULATED=true: the scripted librarian and bootstrap (same checks). Tested.
  memory-bootstrap.ts     Pure apart from a reader: the fixed list of repository files a bootstrap reads, capped. Tested.
  librarian-run.ts        Server: librarianAccess (Lead, API key), requestLibrarianRun, runLibrarian (learn and
                          bootstrap, cost on the Lead, state on the workspace). Tested.
  librarian-request.ts    The two events and requestLearning / sendLibrarianEvent (never throw).
  memory-files.ts         Pure: the memory pull request's path guard (isMemoryFilePath, memoryTreeEntries), branch and
                          file names, planMemoryCommit, title and body. Tested.
  memory-proposals-store.ts Server: listProposals, accept / edit / reject, openMemoryPullRequest,
                          refreshMemoryPullRequests. Tested.
  agent-ai.ts             Config AI (OpenAI if configured, else Anthropic, else OpenRouter): generateAgentConfig() (repo-aware, sandbox-aware instructions),
                          scanAgentWithAI(), reviewSkillWithAI() (upload review + type/load/roles), structuredReply (one
                          strict-schema call on a tier; also the librarian's), isConfigAIAvailable().
  openai.ts               OpenAI client (null without a key), responseCostMicros().
  anthropic.ts            Anthropic client (null without a key), messageCostMicros(), toClaudeSchema().
  openrouter.ts           OpenRouter client (Chat Completions), OPENROUTER_ROUTING (hosts that keep no data, support tools,
                          not 4-bit), completionCostMicros (its reported cost), isOpenRouterOutOfCredit, parseFinishArguments.
  agents.ts               Agents persistence: ensureDefaultAgents(), getAgentTeam(), getAccountSpend() (Settings: month spend
                          across the owner's workspaces), getTeamOverview() (read-only: members +
                          runs in flight for the live process and the Overview),
                          updateAgentConfig(), refreshRuleTrust(), saveTrustScan(),
                          checkAgentCanRun(), logAgentActivity(), stage activity rows, agentMaxTurns(); getAgent(),
                          RUN_AGENT_ID (the analyst), taskKeyPrefix().
  agent-run-config.ts     Pipeline vocabulary shared by server + client: RUN_STAGES + PHASE_META (phases: agents + column),
                          AGENT_STAGES + STAGE_META (one per agent), workingAgents, TOOL_LABEL, RUN_STATUSES,
                          MAX_REWORK_ROUNDS, max-turn limits, ANSWER_MAX + parseAnswer, brief/review/security/Lead/test
                          report types, riskFloor + applyRiskFloor, MERGE_MODES + mergeDecision, BoardCardRun.
  live-process.ts         Pure, client-safe: LiveRun (a run in flight) → liveProcessSteps (six steps), agentDoingSentence.
  ci-gate.ts              Pure, client-safe: the CI gate's vocabulary (CiResult, CiState), classifyCi (one poll →
                          waiting/passed/failed/none/timed_out), ciSummary, ciForRound, logExcerpt (job log → failure).
  run-metrics.ts          Pure, client-safe: Metrics page math (summarizeRuns, outcomes, reworkCause, periods).
  metrics.ts              getWorkspaceMetrics(): runs started in the period + Lead send-backs + spend by agent.
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
                          finish tool, server-side compaction), Anthropic Messages (server-side context editing) or
                          OpenRouter Chat Completions (both: history in agent_run_messages, last-turn message; OpenRouter
                          folds older turns at send time); modelUnavailableReason(), initialLoopState().
  agent-context.ts        Pure: compactChatHistory (OpenRouter: older turns folded into a digest once the unfolded turns
                          pass a threshold, the last two kept verbatim with their reasoning), foldPoint, foldDigest. Tested
                          on run 53's shape.
  agent-turns.ts          Pure: the turn limit (turnsLeftNotice, lastTurnMessage), outOfTurnsOutcome (what a stage that
                          ends without its finish tool becomes), continuableBranch (a rerun continues an unfinished branch).
  agent-request-params.ts Pure: request knobs per model and stage (modelKnobs: the catalog's efforts and verbosity,
                          MODEL_EFFORTS overrides; STAGE_EFFORT, openAIRequestParams, claudeEffort, openRouterRequestParams):
                          only parameters a model is known to accept.
  agent-tools.ts          Agent tools on the GitHub API, filtered by stage + permissions; search_skill / read_skill when the
                          agent has skills; list_references / read_reference when the card has references; the
                          Developer's merge tools (branch-merge.ts);
                          toolStep() (a call → agent log step; never stores file contents).
  repo-paths.ts           Pure: which paths agents may write (protected paths, manifest gate, lockfiles), cleanRepoPath.
  branch-merge.ts         merge_default_branch / read_conflict / resolve_conflict / finish_merge: GitHub's merge API,
                          else a merge planned from the three trees, kept in agent_runs.pending_merge (shas only),
                          committed with two parents, fast-forward only. mergeWriteBlock, clearPendingMerge.
  merge-config.ts         Pure: planMerge (tree plan), routeConflict (agent / lockfile / refused), PendingMerge, the
                          tools' answers, pickContinuedPullRequest (own PR, else the one a follow-up card is for),
                          continuationNote (the brief of a run that continues a PR). Tested.
  diff3.ts                Pure: mergeText (three-way line merge, Myers matching, zdiff3-style markers), matchLines,
                          conflictMarkerLines. Tested, also against git (branch-merge.test.ts runs on a real repository).
  pull-requests.ts        Agent PRs: mergeAgentPullRequest (mergeable + CI green, else Tester follow-up card),
                          mergeManually (user merge: card or PR page), refreshOpenPullRequests, createCardRun (Run and
                          auto pickup: getRerunPullRequest + adoptPullRequest, also for a follow-up card),
                          listPullRequests.
  board-config.ts         Board vocabulary shared by server + client: columns, issue types, priorities, BoardCard.
  reference-config.ts     Card references vocabulary shared by server + client: kinds, limits, detectReferenceFormat (magic
                          bytes), imageDimensions, validateReference, ReferenceView, what agents read (list, paged text,
                          notes, LINK_FRAME + linkAttached), referenceVisionStages + referenceVisionProblem. Pure, tested.
  references.ts           Card references persistence: addTaskReference (validate → local file → PDF text → row under a card
                          lock), addLinkReference (capture → 2 JPEGs + outline as files → row), listTaskReferences,
                          removeTaskReference, deleteTaskReferences (card removed), getReferenceCounts,
                          getOwnedReferenceFile (route); agents: getAgentReferences, readReferenceForAgent,
                          taskHasVisualReferences, loadReferenceImage (image, or a link's desktop / mobile), loadImageObject.
  reference-images.ts     Pure: images as model input per provider, as placeholders hydrated from local storage per request
                          (`techteam-reference:<id>[:desktop|:mobile]`, `techteam-screenshot:<uuid>` for the run's own
                          browser screenshots; OpenAI function_call_output, Anthropic tool_result, OpenRouter user
                          message after the tool messages). Tested.
  reference-pdf.ts        extractPdfText (unpdf, page and character caps) at upload.
  board.ts                Board persistence (tasks table): getBoardData (with latest runs), getBoardCard, createTask,
                          updateTask, reorderTasks, removeTask, assignTask, createAgentTask (agent-filed cards),
                          parseCardInput / parseBoardInput (server-side validation).
  inngest/agent-run.ts    agentTaskRun: the agent pipeline (`agent/task.run`, cancel: `agent/task.cancel`). One step per
                          model turn; stages, rework rounds and merge.
  inngest/agent-pickup.ts agentAutoPickup: cron every 2 min, starts runs on never-run Todo cards (auto pickup on;
                          AGENTS_AUTO_PICKUP=false opts a computer out).
  inngest/preview-sweep.ts previewSweep: every 10 min, stops previews older than 2 h and removes leftovers.
  inngest/run-sweep.ts    runSweep: every 5 min, `sweepStaleRuns` (lib/run-sweep.ts) ends runs left behind when TechTeam
                          stopped (`failure.kind = "interrupted"`, via `stopInterruptedRun`; rules in
                          lib/run-recovery-config.ts: isStaleRun, 30 min without a sign of life, never `waiting`,
                          needs_info or awaiting_merge). Tested.
  inngest/memory-librarian.ts memoryLibrarianAuto (debounces `memory/learn.auto`, 3 min) and memoryLibrarian
                          (`memory/learn.requested`, one per workspace, no retries).
  setup-status.ts / setup.ts  The "Get started" checklist: pure steps (setupSteps) + the server facts (getSetupStatus:
                          account or env key, plan route, simulated); shown by components/dashboard/setup-checklist.tsx on
                          the Overview and, with no workspace yet, on /workspaces/new.
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
scripts/                  sandbox-setup.mjs (`npm run sandbox:setup`: sandbox image + browser image on this computer's
                          Docker; decisions in lib/sandbox/setup-config.mjs), doctor.mjs (`npm run doctor`; checks in lib/doctor/*.mjs behind injectable probes, never prints a value
                          from .env), start-local.mjs (`npm run start:local`; ports and build decision in lib/local-stack-config.mjs),
                          local-db.mjs (`db:local`: the embedded Postgres when DATABASE_URL is unset; settings in
                          lib/local-db-config.mjs, shared with db/index.ts and drizzle.config.ts),
                          backup.mjs / restore.mjs (`npm run backup` / `restore`, docs/setup.md#moving-to-another-computer;
                          the logic is in lib/backup/), import-s3.mjs (storage:import-s3),
                          db-baseline.mjs (mark migrations applied on a pushed DB), sync-agent-skills.mjs (skills:sync),
                          cli-isolation-check.mts (agents on the plan: isolation check; spends plan usage, ask first).
deploy/                   setup.sh: prepares a fresh Ubuntu 24.04 VPS (firewall, swap, Docker, gVisor for agent sandboxes,
                          `techteam` user, Caddy for previews, no host services for containers; `--lock-ssh` = keys
                          only; the link-capture and install networks and their DOCKER-USER private-range rules).
                          Idempotent, so the next VPS runs the same script. browser/: the sandbox browser image (run.mjs:
                          browse_preview; capture.mjs: link captures; net-guard.mjs: the public-address rules, also
                          imported by the app; fonts.conf: fontconfig aliases so UI stacks render real bold).
proxy.ts                  Host guard on every request (DNS rebinding) + optimistic `tt_session` guard for /dashboard and /workspaces.
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
- Get the user with `requireUser(returnTo)` (pages/actions) or `getCurrentUser()` (route handlers). `proxy.ts` is only an
  optimistic guard: it checks that a `tt_session` cookie exists, `getCurrentUser()` verifies its signature and expiry.
- Sign-in is GitHub only (device flow, or a pasted personal access token): one step is identity and repository access, and
  it saves the token (`saveGithubConnection`) and opens the session. There is no password, sign-up or remote auth service.
  A user is found by `users.github_user_id` (`resolveUser`); the owner's first sign-in on a database with one existing
  user asks before adopting that data. The device code stays in a sealed httpOnly cookie, never in the page.
- The app listens on `127.0.0.1`: any URL the app calls on itself uses `127.0.0.1` (`selfOrigin`), not `localhost` (it can
  resolve to `::1` first). `proxy.ts` answers 403 to a `Host` that isn't loopback or `NEXT_PUBLIC_APP_URL`'s host.
- Pages under `/dashboard/[workspaceId]` call `getDashboardContext(workspaceId)` — never query the workspace by id
  directly. It is `cache()`d, so layout and page share one lookup.
- Every id that comes from a request is untrusted: load it with an owner-scoped query (`getOwnedWorkspace(ownerId, id)`).
- Post-auth redirects go through `isSafeRedirectPath` (`lib/safe-redirect.ts`) — never redirect to a raw query value.

**Server actions & forms**
- Action signature: `(prev: State, formData: FormData) => Promise<State>`, used with `useActionState`.
- Validate every field on the server even if the client validated it. Return `{ errors: { field: "Message." } }` for field errors and `{ message }` for form-level ones; `redirect()` on success.
- Show field errors with `useFieldErrors(state)` (`hooks/use-field-errors.ts`) so they clear on edit.
- Re-validate external state at write time (e.g. `createWorkspace` re-reads the repo from GitHub instead of trusting client data).

**Secrets & external services**
- GitHub tokens are stored only via `saveGithubConnection` (encrypted) and read only via `getGithubToken`. Never send a token, ciphertext or storage key to the client.
- AI provider keys are stored only via `saveProviderKey` (verified with the provider, encrypted, on the account, used by
  every workspace the user owns; the environment's key only covers a provider the account has none for) and read only via
  `getAIKeys`. The client only ever gets `ProviderKeyView` (masked hints + the source in use); the show/hide eye applies to what the
  user is typing, never to a saved key. Model calls take the key as an argument (`openAIClient(key)`, `anthropicClient(key)`).
- A stored secret is read with `tryDecrypt` (`lib/crypto.ts`), never bare `decrypt`: when the encryption key changed it
  returns null and the secret counts as **not set** (an unreadable AI key is "not connected", its `SavedKeyView` has
  `unreadable: true` so Settings asks for it again; an unreadable GitHub token makes `getGithubToken` throw the 401
  `GithubError`, i.e. "connection expired"). A page must never 500 on one. A bad key configuration still throws.
- Uploaded files go to local disk via `lib/storage.ts` (keys are relative, validated, and the only thing the database holds). Allowed logo types: PNG, JPEG, WebP, GIF, ≤ 1 MB. No SVG (script risk).
- Handle a GitHub `401` as "connection expired": prompt the user to reconnect.
- New env vars must be added to `.env.example` with a placeholder and a comment. Never put real credentials in `.env.example`.

**Database**
- Change `db/schema.ts`, then `npm run db:generate`, read the SQL, `npm run db:migrate`, and commit schema + migration +
  code together. `db:push` is for throwaway local databases only. Never touch an `auth` schema (left by the removed
  hosted auth service; drizzle is limited to `public`). A table dropped from the schema goes into `RETIRED_TABLES` in
  `lib/backup/registry.mjs` so older backups still restore ([`docs/data-model.md`](docs/data-model.md#retired-schema)).
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
  earlier runs waiting on it end as replaced, `replaceWaitingRuns`); the analyst's and developer's briefs say so
  (`continuationBlock`). The Tester's **follow-up card** of a PR that couldn't merge (`pull_requests.follow_up_task_id`)
  does the same: its run (Run or auto pickup, both through `createCardRun`) takes that PR over, the brief names the
  original card and the merge error, and for a conflict tells the Developer to start with `merge_default_branch`. The
  follow-up card carries the run; the merge moves both cards to Done (`completeMerge`). Refused while another card's
  run works on the same PR.
  The PR is re-checked on GitHub first (`getRerunPullRequest`), and every board sync applies merges/closes done on
  GitHub (`refreshOpenPullRequests` in `syncIssuesAction`), so cards never offer Merge on a closed PR. They render as siblings of the card inside
  the sortable wrapper (the card is only the drag *activator*), so they never start a drag or open the dialog.
  - **Run** (`runCardAction`) creates an `agent_runs` row, queues `agent/task.run` with its `runId`, then moves the card
    to Analysis assigned to the analyst; if queuing fails the run is marked failed and nothing moves. Refused while a
    run is active, when an agent's model has no provider key (`pipelineModelProblem`), or when the analyst is paused/over budget. Locally: `npm run dev` starts the Inngest Dev Server too.
  - **Stop agents** (`stopCardAction`) marks the run cancelled, sends `agent/task.cancel` and unassigns the card (also
    while it waits for the owner's plan to reset: the card then says "Waiting for your Claude plan · resets …").
  - Cards show their latest run with `AgentRunStatus`; ▶ is disabled while it is queued/running, and the board re-reads
    itself every 10 s while any card has an active run (`useGithubSync({ live })` → `getBoardAction`, database only;
    GitHub stays on the 60 s sync).
  - **Remove task** (`removeCardAction`, after an `AlertDialog` confirm) sets `removed_at`. Rows are never deleted:
    keys aren't reused, and a removed GitHub card is never imported again (the issue stays open on GitHub).
    Every board query goes through `onBoard()` in `lib/board.ts`, which skips removed rows. The board opts out of the page max width with
  `data-page-width="full"` and scrolls horizontally (snapping on mobile). It never grows the page: from `md` up it
  fills the panel's height (the layout gives a full-width page `min-h-0`; at least 24rem, then the panel scrolls), on
  phones it is 75svh tall, and each column scrolls inside under its fixed header (`overflow-y-auto` on the drop
  area; dnd-kit auto-scrolls it while dragging). A highlighted (just created or saved) card scrolls into view.
  Collapsed columns show `COLUMN_PREVIEW` cards (`previewCards` in `board-filters.ts`, tested) plus the dragged and
  highlighted card, with **Show N more** / **Show less** (`expanded` in `KanbanBoard`, per visit); filters show all;
  a drop past the preview opens the column.
- **References** (`CardReferences` in the card dialog, `lib/references.ts`, [`docs/features.md`](docs/features.md#card-references)):
  files the owner attaches to a saved card (GitHub cards too: board-owned) for the agents. Rules:
  - **Type by content**, never the name alone (`detectReferenceFormat`): PNG/JPEG/WebP, UTF-8 Markdown/text, PDF. No
    SVG. Limits live in `lib/reference-config.ts` only (10 per card; image 5 MB, text 1 MB, PDF 5 MB). The dialog sends
    one file per Server Action call so each fits `serverActions.bodySizeLimit` (6 MB).
  - **Files and PDF text live on local disk** (`card-references/<workspace>/<task>/<uuid>.<ext>`); `task_references` keeps a
    small row. Never put file content or base64 in the database. Served only by the owner-checked route.
  - **Removing a card deletes its references** (`removeTask` → `deleteTaskReferences`: rows, then files best effort, logged).
  - The board card shows a paperclip + `BoardCard.references` (count); the dialog reports changes back to the board.
  - **Links** (`kind: "link"`, [`docs/sandbox.md`](docs/sandbox.md#link-captures)): captured **once**, when added, by
    the sandbox browser (`captureLink`): desktop and mobile JPEGs (`storage_key`, `mobile_key`) and an outline
    (`text_key`), plus `source_url`. Agents never browse the internet. SSRF: every address goes through
    `deploy/browser/net-guard.mjs` (link check in the app, then the runner's proxy resolves and checks every request,
    redirects and subresources included, and connects to the checked address); never add a capture path that skips
    the proxy. The input is disabled without `SANDBOX_DOCKER_HOST`. A failed capture stores nothing.
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
  Development, branch `agent/<key>-<slug>`, PR) → CI gate (still In Development) → Reviewer and Security in parallel
  (In Review) → Lead (approval, still In Review) → Tester (Testing) → merge (Done). Rules:
  - **CI gate** (`waitForCi` → `startCiWait` / `pollCi`, pure rules in `lib/ci-gate.ts`): after every push, one step
    per poll with `step.sleep` between, until every check finished (`classifyCi`). Failing checks the change caused
    (not failing on the default branch's head too) → a rework round; the Developer's brief then carries only the
    failures (`ciFeedbackBlock`: annotations without the runner's `.github` ones, plus `logExcerpt` of the job log,
    fetched when the brief is built and never stored; CI output is untrusted data). Results live in `agent_runs.ci`
    (one per round); the Lead and the Tester's pre-checks read the round's result. Only workflows in
    `.github/workflows/` count as CI (GitHub's dynamic Pages workflow never runs on PRs). Rework rounds from CI, the
    Lead and the tests share `MAX_REWORK_ROUNDS`.
  - **Phase vs stage**: a phase (`RUN_STAGES`, stored in `agent_runs.stage`, shown on the board and the live process)
    can hold two agents; a stage (`AGENT_STAGES`) is one agent's tool loop. The agent log (`agent_run_steps.stage`), the
    Claude conversation key (`<stage>:<round>`) and Inngest step ids use the stage, so parallel work never collides.
    Only a phase's first agent moves and holds the card (`placeTask`).
  - **Parallel review**: `Promise.all` of two `runStage` calls; each turn is still its own step. `beginStage` marks the
    run running only while it's still active (`markStageRunning`), and `runStageTurn` stops when the run isn't
    active any more, so a stop in one stage ends the other at its next turn. `stopRun` takes the stage that stopped;
    a second stop only closes that stage's log and activity (one notification).
  - Each stage is a tool loop of at most the agent's max turns, **one Inngest step per turn**; the last turn asks for the
    stage's finish tool (strict JSON schema; OpenAI forces it, OpenRouter offers only it). Step bodies reload state from
    the DB — never keep state in closures.
  - **The turn limit never throws work away** (`lib/agent-turns.ts`): three turns before the end the agent gets a
    wrap-up note after its tool results (`turnsLeftNotice`, stored, append-only); the last-turn message asks the
    Developer for `complete: false` + `remaining_work` when unfinished. `submit_work` has both fields; an unfinished
    `WorkResult` goes through PR, CI and reviews like any other, and the Lead sends it back with the remaining items. A
    stage that still ends without its finish tool goes to `settleOutOfTurns` (`outOfTurnsOutcome`): the Developer's
    commits continue with a written "ran out of turns" result (none, or a rework round without a new commit: the run
    stops); a missing Reviewer or Security report becomes a failed check with `incomplete: true` (the Lead looks at the
    diff itself, and `riskFloor` raises to medium); the Analyst, the Lead and the Tester stop the run. A rerun continues
    the previous run's branch when that run stopped with commits and no PR (`prepareBranch` → `continuableBranch`,
    `earlierBranchBlock` in the Developer's brief).
  - **Context per turn**: every turn resends the conversation, so keep it small without breaking caches or reasoning.
    OpenRouter: `compactChatHistory` at send time (stored rows stay verbatim; the fold point only moves at thresholds,
    so the prefix stays cacheable; never drop reasoning from a kept turn: DeepSeek, Kimi and GLM require it back, Gemini
    its signatures). Claude: never edit earlier turns client-side (5.5 models bind thinking blocks to the history they
    were made in); server-side context editing (`clear_tool_uses_20250919`, beta `context-management-2025-06-27`) clears
    in large steps on long stages. OpenAI: Responses `context_management` compaction, server-side, with
    `previous_response_id`. Request knobs (`reasoning.effort`, `text.verbosity`, Claude's `output_config.effort`) come
    only from `lib/agent-request-params.ts`, per model: never send OpenRouter a parameter its `/models` doesn't list
    (`require_parameters` would leave no host); an OpenAI 400 on an optional knob retries the turn without it.
  - **Sandbox** (`lib/sandbox/`, [`docs/sandbox.md`](docs/sandbox.md)): with Settings → Sandbox on and `tests.run`, the
    Developer and the Tester get `run_tests` / `run_build` / `run_command` on the branch's latest commit. The repository
    goes in as a tarball (never a token); install has network, the command never does; one volume per run, removed in
    `finishRun`. The install step (and a preview's) runs on `techteam-sandbox` (`SANDBOX_NETWORK`, icc off, a fixed
    subnet that `deploy/setup.sh` keeps off private ranges in DOCKER-USER) with public resolvers mounted over
    `/etc/resolv.conf` (Docker's DNS doesn't answer under gVisor and `--dns` doesn't change that). Never add a container
    with network outside a network those rules cover. **Two modes** (`lib/sandbox/mode.ts`, docs/sandbox.md#local-mode):
    `remote` (`SANDBOX_DOCKER_HOST`) is as above; `local` is the owner's own Docker: no gVisor, no firewall, so installs run
    with `--ignore-scripts` (`localInstallCommand`; `sandbox_commands.allowInstallScripts` opts in), the host's names pin to
    127.0.0.1, previews are `http://127.0.0.1:<port>` through a forwarder container, link captures stay remote-only. Every
    argument list lives in `lib/sandbox/docker-args.ts`: a new flag goes there, with the test that forbids privileged,
    the socket, host mounts, host network, added capabilities and devices. The sandbox's availability is async
    (`getSandboxStatus`): never assume it. Log the command and the outcome line only (`toolStep`), never the output. The stage protocol says
    "you can't run code" only to agents without the tools.
  - **Adding a package** (`add_dependency`, [`docs/sandbox.md`](docs/sandbox.md#adding-a-package)): development stage,
    `code.write` + `deps.manage`, sandbox on (not `tests.run`: it runs no code). Validated name/version
    (`parseDependencyArgs`), npm only (`dependencyPlan`), `npm install --package-lock-only --ignore-scripts` in the
    prepare container on its own volume (`addPackageInSandbox`), files read back without network, one commit through
    `commitFiles` (Git Data API, fast-forward only). Never let an agent edit a lockfile by hand to add a package. The
    protocol (`DEPENDENCY_GUIDANCE`) is shown only to a Developer with the tool: fonts the card names go in as bundled
    packages (`@fontsource/…`), never a font host `<link>`; agents don't pick fonts.
  - **Previews** (Settings → Sandbox → Previews, `SANDBOX_PREVIEW_DOMAIN` on a remote host; local: `127.0.0.1`): after the CI gate passes, a
    `preview-<round>-start` step and `-poll-<n>` steps run beside the reviews (the Lead waits for them, up to 8 min).
    A preview never fails the run; it logs one `preview` row. Stopped on merge/close (`completeMerge`,
    `closeWithoutMerge`), cancel or replace, and after 2 h (`preview-sweep`). Container, network and volume are all
    `previewTarget(runId).container`; the network is `--internal`.
  - **Browser** (`browse_preview`): offered in `PREVIEW_STAGES` (testing) with `tests.run` and previews on. One
    container per call on the preview's network (`--add-host`: Docker's DNS doesn't work under gVisor). Viewports
    desktop / tablet / mobile, `color_scheme` light / dark. The agent log keeps the path and the first line
    (`browseReport`, never page text) plus the screenshot key; the client only gets `RunLogStep.screenshot: boolean`.
    A model with vision also gets the screenshot, as a `techteam-screenshot:<uuid>` placeholder resolved only under
    the run's own key (`runScreenshotKey`). Tool call sites use `callTool` (output + log step + images). The image tag
    (`BROWSER_IMAGE`) carries a scripts revision: bump it when anything in `deploy/browser/` changes.
  - **References** (`list_references`, `read_reference`): offered in every stage when the card has references, read-only,
    loaded every turn. Text and PDF text come back paged; images as image input, **never stored**: the conversation
    (and OpenAI's pending outputs) keep a placeholder that `lib/reference-images.ts` hydrates from local storage per request (a
    removed reference becomes a note). Keep the fixed-position rules of `agent_run_messages`. A model without `vision`
    gets a note instead of the image. The agent log keeps the reference's name only. The protocol frames references as
    the owner's requirements but data; the Analyst's brief lists the ones to follow (`AnalystBrief.references`).
    A link comes back as its outline plus both screenshots, framed as third-party content (`LINK_FRAME`: structure and
    style only, never its logos, brand names, images or texts). Run and auto pickup refuse a card with images or links
    when the Analyst or the Developer can't see them, or the Tester while previews are on (`referenceVisionStages`,
    `referenceModelProblem`; pickup then takes the next card without them, `nextPickupTask`); models are never
    switched for the user. With a browser and images or links, the Tester's protocol compares the preview with them
    (closest viewport, light and dark; a clear mismatch is a test fail).
  - **Permissions are enforced as tools** (`toolsFor` in `lib/agent-tools.ts`). Adding a capability = a tool gated by a
    permission there, not a prompt instruction. ("Skills" are knowledge, not capabilities: see Agent skills below.) Agents never write `.github/workflows/`, `.env*` (except `.env.example`) or
    `.git/`, `.techteam/` (the Brain's notes); manifests need `deps.manage` (adding a package: `add_dependency`). The rules live in `lib/repo-paths.ts`
    and apply to merge resolutions too. Tool output is untrusted data — the stage protocol in `systemPrompt` says so.
  - **Merging the default branch** (`lib/branch-merge.ts`, Developer with `code.write` on its branch): `merge_default_branch`
    tries GitHub's merge API (`POST /merges`: a real merge commit); on a conflict it plans the merge from the merge base's,
    the branch's and the default branch's trees (`planMerge`), merges overlapping-but-compatible files line by line
    (`mergeText`), takes the default branch's lockfiles, and refuses (nothing changed, the owner merges) protected
    paths, links/submodules, binary or > 200 KB files, manifests without `deps.manage` and more than 20 conflicts. The
    rest wait in `agent_runs.pending_merge` (shas only; resolutions are blobs in the repository): `read_conflict` shows a
    file with markers (recomputed, never stored), `resolve_conflict` refuses leftover markers and stores a blob,
    `finish_merge` commits the default branch's tree + the branch's own changes + the resolutions with parents [branch
    head, default head] and moves the ref fast-forward only; either head moving drops the merge (start over). While a
    merge is open the write tools and `add_dependency` are refused; each development stage starts with none. The Tester's
    pre-check **Merges cleanly** fails a PR GitHub reports as conflicting, so it goes back to the Developer. GitHub
    refuses merges that bring in workflow changes without the `workflow` scope: the tool says so, the owner updates
    the branch.
  - **Each agent picks its company and model** (AI Team → Configure: a Company select, then that company's current
    catalog models via `pickerModels`; changing company picks the closest tier, `agentModelFor`). `agents.model` is the
    model's route id and its company follows from it (`modelProvider`); read it with `activeAgentModel(row)`. Every
    company with a key is available (Settings → `#ai` has no team-wide switch). `saveAgentAction` refuses a new model the catalog doesn't offer now, or whose company has no key (and no plan
    route). New agents start on `defaultProvider(keys)` (OpenAI, Anthropic, then OpenRouter). Role defaults are a
    **tier** (`defaults.tier`: balanced, the Tester fast), resolved per company by `roleDefaultModel` (`pickInTier`: the
    tier's cheapest current model; on OpenRouter DeepSeek's first). `agents.provider_models`
    remembers each agent's model per company for out-of-credit moves (`moveAgentsToProvider`). Config AI (drafting,
    trust reviews) runs on OpenAI, else Anthropic, else OpenRouter (`configAI`), on the Analyst's default model there.
    Run refuses up front when any agent's model has no key (`pipelineModelProblem`).
  - **Routes: the owner's plan through a local CLI** ([`docs/cli-agents.md`](docs/cli-agents.md)): only when TechTeam
    runs locally (`cliAgentsAvailable`); a deploy never shows, detects or spawns a CLI. `resolveRoute` picks each stage's
    route on the computer that runs it (plan when Claude Code is switched on there, signed in with a plan login to the
    confirmed account and the plan includes the model; else the API key; else Run refuses) and pins it in `LoopState`
    (`provider: "cli"`, session id). Never edit an agent's model to change a route. A plan stage runs chunks of up to
    10 turns (`claude -p --resume`), with **no built-in tools**: only TechTeam's tools through
    `app/api/mcp/runs/[runId]` (same `toolsFor` + `callTool`, each call logged as it happens, the finish tool stores
    the result in `agent_runs.cli_results`). Claude Code always runs with TechTeam's own `CLAUDE_CONFIG_DIR`, the
    isolation flags of `claudeChunkArgs` and `childEnv` (allowlist): never the owner's normal login, settings, MCP
    servers or hooks, never the parent's env, never a secret on argv. Plan usage goes to `agent_activity.tokens` /
    `equivalent_micros` (`billing = 'plan'`), never `cost_micros`; budgets don't apply to plan stages. The plan running
    out follows the owner's choice (`planLimitAction`: wait and resume the session with `step.sleepUntil` and
    `agent_runs.waiting`, restart on the API key, or auto failover), else `failure.kind = "plan_limit"`. One run in
    flight per card (unique partial index): handle `createRun` returning null.
  - **Models and providers come from the model catalog** (`lib/model-catalog.ts`, [`docs/model-catalog-plan.md`](docs/model-catalog-plan.md)):
    OpenRouter's public `GET /api/v1/models` (no key), which lists Anthropic's and OpenAI's own models too, stored in
    `model_catalog` (shared by every workspace and computer), refreshed when older than a day (AI Team and Settings
    schedule it with `after`; never in simulated mode) and with Settings → AI → **Refresh models**. Never write a model
    list in code: new models arrive with the catalog. Only `lib/model-seed.ts` (the fallback before the first fetch) and
    per-model overrides (`MODEL_EFFORTS`, Claude's `FALLBACK_MODELS`) name ids. Route ids: `anthropic/claude-opus-5.5` →
    `claude-opus-5-5` (Anthropic API, Claude Code), `openai/gpt-6.1-sol` → `gpt-6.1-sol`, OpenRouter ids as they are.
    The filter (`parseCatalogResponse`, `buildCatalog`): OpenAI `gpt-*`, Anthropic `claude-*`, OpenRouter's makers in
    `OPENROUTER_MAKERS`; tools **and** structured outputs in `supported_parameters` (every stage ends on a strict finish
    tool), text out, no `:variant`, preview or expired model, no OpenRouter mode twin (`-pro` at its base's price);
    offered = the newest of each family whose family shipped within 183 days of its company's newest. Tiers rank each
    company's current models by output price (top third flagship, bottom third fast); moving company keeps the tier
    (`closestModel`, nearest price within it). A model that leaves the catalog keeps its row (`listed` false): agents
    on it keep running ("older" in AI Team), priced at the last stored price. Every lookup can miss: an unknown model
    has no price (cost 0, warned), no vision and no knobs. Request knobs come from the catalog
    (`reasoning.supported_efforts`, `verbosity`) through `modelKnobs`. Unit tests and simulated mode never fetch.
    The model is pinned per stage in `LoopState` (a change on the AI Team page applies from the next stage).
    Claude's conversation is stored in `agent_run_messages` (append-only, written at fixed positions so a retried step
    overwrites itself); thinking blocks go back unchanged. Claude 5.5 models reject forced tool choice, so the last turn
    is a mid-conversation system message instead. Opus/Sonnet 5.5 use refusal `fallbacks: "default"`. OpenRouter
    (Chat Completions) stores its conversation the same way, sends tool calls and `reasoning_details` back unchanged,
    routes with `OPENROUTER_ROUTING` (never send code to hosts that keep data), ends with a last-turn user message
    (many hosts reject forced tools) and re-checks the finish call (`parseFinishArguments`: hosts don't all enforce
    strict schemas). Its cost is `usage.cost` as reported.
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
    low risk), so the whole flow runs without a model. On a card with references each stage lists them and reads the first. With the sandbox on, the Developer and the Tester also call
    `run_tests` and `run_build` for real, and with previews on the Tester browses `/` (tablet, dark).
  - **Out of credit** (`isOpenAIOutOfCredit` / `isAnthropicOutOfCredit` / `isOpenRouterOutOfCredit`) is not a generic failure: the run stops with
    `agent_runs.failure = { kind: "out_of_credit", provider }` and the board offers switch-and-retry
    (`switchProviderAndRetryAction`: moves the agents still on that company to `fallbackProvider`: the first company in
    the workspace's `ai_fallback_order` (Settings → AI → This workspace only; null = OpenAI, Anthropic, OpenRouter) that
    isn't the broke one and has a key; the plan-limit "Switch company" policy and the credit notice use it too). With `workspaces.ai_auto_failover` and another company's key, `runStageTurn` moves every agent on the broke company (`moveAgentsToProvider`) and returns
    `restart` instead: the stage starts over, at most once per stage. After a failover it
    never switches back (`failedOver`): the second company running dry stops the run with `out_of_credit`.
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
    `lib/builtin-skills.ts` (plus `outputFileTracingIncludes` for `/api/inngest`).
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
- **Brain** (`/dashboard/[id]/brain`, [`docs/brain-plan.md`](docs/brain-plan.md); parts A to C): notes agents read before they work, like
  skills **reference data, never executed and never instructions**, the signals it learns from and the librarian's proposals. Rules:
  - **Notes are untrusted text.** Every note (a repository file in mode `repo`, a row otherwise) goes through `parseNoteFile` /
    `validateNote` and `scanMemoryNote` on save **and at load time**; a critical finding or an invalid file is skipped and
    counted, never an error for a run. A note can never add a tool or a permission, and the operating protocol says so.
  - **Isolation lives in `visibleNotes`** (`lib/memory-config.ts`): a workspace's agents see that workspace's project notes and
    its owner's global notes, nothing else. Every read path (loader, prompt block, `search_memory`, `read_memory`) goes
    through it; never query `memory_notes` for an agent any other way. Server actions touch a row only in the owner's place.
  - **Modes** (`workspaces.memory_mode`): `repo` reads `.techteam/memory/conventions.md` (the always-loaded core) and
    `notes/*.md` from the default branch with the owner's token (`lib/memory-loader.ts`, cached ~60 s); `local` reads
    `memory_notes` rows of the workspace; `off` loads nothing, not even the owner's notes. `.techteam/` stays in
    `PROTECTED_PATHS` (no agent write tool or merge resolution can touch it): only the memory pull request writes there.
  - **The Memory block is pinned per stage** in `LoopState.memoryBlock` (first turn), like the model, so the system prompt is
    byte-identical across turns; it sits after the skills block (`buildMemoryBlock`: project core ≤ 2,000 characters, then the
    owner's ≤ 1,000, whole notes, fixed order). `search_memory` / `read_memory` are read-only, offered in every stage when notes
    exist, listed in `READ_TOOLS`, logged by key. New limits live in `lib/memory-config.ts` only.
  - Brain actions need the same care as other forms: field errors per field, the scan's findings returned for the dialog.
  - **Signals never throw into a run, a sync or an action** (`lib/memory-signals-store.ts`): every writer catches, warns
    once with the database's message (never the query or the text) and returns; add new sources through it, with a builder
    in `lib/memory-signals.ts` (capped, scanned, a dedupe key so a retried step or a second sync adds nothing, and
    `trusted` only for words the owner typed in the app). Nothing the scan refuses is stored. **Agents get no tool that
    reads signals.**
  - **With memory `off`, nothing is collected or asked on its own** (`collectsSignals` in `lib/memory-signals.ts`, the
    one rule; a new automatic source checks it): pending questions are hidden, not rewritten. **Remember this** doesn't:
    it is the owner's own action.
  - Sources, one hook each: `closeWithoutMerge` → `askWhyRejected` (`shouldAskWhyRejected`: never for a merged or
    replaced pull request; `pull_requests.rejection_prompt` makes it once), `startRework(runId, round, cause)` (the only
    place a rework round begins; it sets the round, so a retry changes nothing), `answerAnalyst`, `recordApproval` (the
    Lead's `lessons`: required in the strict schema, no `maxItems`, parsed by `parseLessons`, never able to fail an
    approval — `parseFinishArguments` fills them in — and never stored with the decision), and **Remember this**. Failure
    signals aren't recorded yet.
  - **The librarian's model has no tools and no write access**: one structured call (`structuredReply`, request knobs only from
    `agent-request-params.ts`) on the Lead's pause and budget, API keys only, fast tier to learn and balanced to
    bootstrap, never a model id in code. Its answer is believed in nothing: `lib/librarian.ts` checks cited signals,
    targets (project notes it was shown), validation, the scan, dedupe (notes, waiting and rejected proposals) and
    computes `untrusted_origin`. Signals are consumed only in the transaction that saves the proposals of a successful
    step. A new rule goes there with a test, and in the simulated librarian's path too (it passes the same checks).
  - **The model never writes the owner's global memory.** Its schema has no scope and the server refuses one. Global
    proposals come only from `rememberedProposals`: each trusted "Remember this" for everything (`asksForEverything`),
    verbatim, never sent to a model, proposed at the start of a learning run before the key, pause and budget checks.
    Don't add another source of global proposals (promotion, part D, needs its own rules).
  - **Requests never throw** (`requestLearning`, after a merge, a close, a rejection reason or Remember this): memory off
    or `memory_auto_learn` off sends nothing; automatic runs are debounced (`memory-librarian-auto`), one per workspace.
    Unit tests must mock `@/lib/inngest/client`: the real one posts to whatever Dev Server runs on the computer.
  - **Delivery**: every proposal query names workspace and owner. Accepting re-validates and re-scans, refuses a changed
    target (superseded) and needs the confirmation for untrusted ones, in one transaction. The repository is written only
    by `openMemoryPullRequest` (the owner's click): paths only through `memoryTreeEntries` (the guard, in
    `lib/memory-files.ts`), commits fast-forward on `agent/memory-*`, never merged by TechTeam, never in `pull_requests`.
    Text posted to GitHub goes in code spans or blocks, and signals are cited by reference, not quoted.
  - Timestamps shown to the owner are written with `new Date()` (the columns' `defaultNow()` reads back shifted).
- **Pull Requests** (`/dashboard/[id]/pull-requests`): the page calls `refreshOpenPullRequests` (picks up merges/closes
  made on GitHub), then renders `PullRequestsView`: approval (the Lead), tests and risk chips. **Merge** only for PRs
  the Lead approved and tests passed.
- **Metrics** (`/dashboard/[id]/metrics`, `?days=` 7 / 30 / 90): runs *started* in the period. The math is pure and
  tested (`summarizeRuns`); success rate = delivered / (delivered + failed), cost per delivered card = all spend in
  the period / delivered. A rework round's cause: CI if that round's CI failed, else the Lead if its approval result
  in the agent log says it sent the work back, else the tests. Charts are ranked one-hue bars (`BarList`,
  `bg-brand-emphasis`) with every value printed, so no hover is needed; outcomes carry an icon and a label.
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
  avatar (`HeaderUserMenu`: Settings, Agent skills, Theme, Sign out — one item per page, no anchors into Settings); the
  sidebar has no footer menu.
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

Every setting is optional: see `.env.example` and [`docs/setup.md`](docs/setup.md#settings-environment-variables) for the
full table. Nothing needs a secret in `.env` (the encryption key, the session secret and the database password are
generated in the data folder). A new variable goes in `docs/setup.md`, `.env.example` and here.

| Variable | Needed for |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | The address the app is opened at (`.env.example` sets `http://localhost:3000`): host guard, cookie `Secure`, the self-call origin and `cliAgentsAllowed` (agents on the plan need a local address). Match it when `TECHTEAM_PORT` moves the port. |
| `TECHTEAM_PORT`, `TECHTEAM_INNGEST_PORT` | Ports of the app and the Inngest Dev Server for `start:local` and `doctor` (defaults 3000 and 8288). `npm run dev` always uses the defaults. |
| `GITHUB_CLIENT_ID` | Optional. Client id of the GitHub OAuth App used for sign-in (Device Flow enabled); default: the project's app (`lib/github-client-id.ts`). Public; there is no client secret and no callback URL. |
| `TOKEN_ENCRYPTION_KEY` | Optional. Encrypts GitHub tokens and AI provider keys (`openssl rand -base64 32`); unset, a key is generated in `<TECHTEAM_DATA_DIR>/encryption.key`. Moving to another computer needs that file (or this value), otherwise reconnect GitHub and re-enter the AI keys. |
| `TECHTEAM_DATA_DIR` | Where files (logos, screenshots, references) are kept: `<dir>/files`. Default `~/.techteam/data`. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | Optional fallback for a company the owner saved no account key for (Settings → AI). |
| `SANDBOX_DOCKER_HOST`, `SANDBOX_IMAGE` | Agent sandboxes: a remote Docker host (`ssh://…` to a VPS set up with `deploy/setup.sh`, or the local socket on it). Unset: this computer's Docker (after `npm run sandbox:setup`), else Settings → Sandbox can't be switched on. `TECHTEAM_SANDBOX=off` switches the sandbox off (not in `.env.example`). |
| `SANDBOX_PREVIEW_DOMAIN`, `SANDBOX_BROWSER_IMAGE` | PR previews at `pr-<n>-<random>.<domain>` (wildcard DNS to the sandbox host) and the sandbox browser image (the Tester's browser, link captures). Unset domain: previews can't be switched on. |
| `AGENTS_SIMULATED` | Local testing: `true` runs the pipeline with scripted agents (`lib/agent-simulated.ts`) — no model calls or spend, but real GitHub work (branch, `agent-simulations/<branch>.md`, PR). |
| `AGENTS_LOCAL_CLI`, `TECHTEAM_CLI_HOME`, `CLAUDE_CLI_PATH` | Agents on the owner's plan (local only, nothing to switch on): `AGENTS_LOCAL_CLI=false` turns it off on this computer; TechTeam's CLI home (default `~/.techteam/cli`); Claude Code's binary when it isn't in a known place. |
| `DATABASE_URL`, `TECHTEAM_PG_PORT` | Optional. Unset `DATABASE_URL` = the embedded Postgres in `<TECHTEAM_DATA_DIR>/postgres` on `127.0.0.1:<port>` (default 54329). Set = that database, nothing embedded starts. |
| `AGENTS_AUTO_PICKUP` | `false` keeps the auto pickup cron off on this computer (each computer's Inngest runs it; they share the database). |
