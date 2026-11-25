# Changelog

Notable changes per version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/): `0.x` while TechTeam isn't deployed to production.

Add each change under **Unreleased** in the same pull request. A release moves those entries under a new version
heading. See [Releasing](docs/roadmap.md#releasing).

## [Unreleased]

### Added
- **The Brain, part A (foundation)**: a **Brain** page where you keep the notes your agents read before they work.
  Project notes live as files in the repository (`.techteam/memory/conventions.md`, the always-loaded core, and
  `notes/<name>.md`) or, if you prefer nothing added to the repository, as notes TechTeam keeps for you (**On this
  computer**), or are off. **Your memory** holds notes that apply to every project of yours. Every stage's prompt gets a
  **Memory** block (reference data that never overrides the operating protocol), every agent gets read-only
  `search_memory` / `read_memory` when notes exist, and the Reviewer checks the change against them. A security scan
  (prompt injection, commands to run, secrets, outside links, hidden characters) refuses unsafe notes on save and skips
  them on load. The page shows what loaded, what was skipped and why, and the exact block agents get with its size.
  Migration `0021` adds `memory_notes` and `workspaces.memory_mode` / `memory_bootstrapped_at` (included in backups).
  Nothing learns or writes to your repository yet: see [docs/brain-plan.md](docs/brain-plan.md).
- **The Brain, part B (signals)**: TechTeam now writes down what you reject and correct, to learn from later. A pull
  request closed without merging asks **Why was this rejected?** once, on its card and on the Pull Requests page
  (dismissible; never for one TechTeam replaced with another, or a merged one). Rework rounds (CI, the Lead, tests), your
  answers to the Analyst, up to three **lessons** the Lead suggests with its decision, and **Remember this** (card menu
  and agent log) are recorded too. The Brain page's new **Activity** lists them, marked *Trusted* only for words you
  typed, and you can delete any. Every text is capped and scanned (a refused one isn't stored), at most 500 per
  workspace, and agents can't read them. Migration `0022` adds `memory_signals` and `pull_requests.rejection_prompt`
  (included in backups): run `npm run db:migrate` (`npm run dev` applies it at start). Nothing turns a signal into a note
  yet.

### Fixed
- **An open redirect after sign-in.** A `next` such as `/<tab>/evil.example` passed the check, and browsers drop the tab
  and read it as another site. Destinations with control characters or backslashes are refused now.
- **Reconnect GitHub works while signed in.** The buttons led to the sign-in page, which sent a signed-in owner straight
  back, so a rejected GitHub token could only be replaced by signing out first. They now open a reconnect view that
  authorizes again and returns you to where you were; only the account you signed in with is accepted. The Brain page's
  notice and Settings have the same link.
- The Brain page no longer shows Next's red error overlay when GitHub rejects the saved connection: it logs one warning
  and shows the reconnect notice.

## [0.10.0] — 2026-11-24

The agent sandbox now runs on your own computer's Docker (no VPS needed), there is a smoke test of the whole agent
pipeline, and the database is cleaned of the schema nothing uses. **Existing installations**: run `npm run backup`
first, then `npm run db:migrate` (migration 0020 deletes the data in tables nothing uses; `npm run dev` applies it at
start). To use the sandbox, start Docker and run `npm run sandbox:setup` once.

### Added
- **`npm run smoke`**: one card through the whole agent pipeline in simulated mode against a throwaway GitHub repository,
  on its own stack (separate build folder, ports, temp database and data folder, so a running TechTeam is untouched).
  Checks every stage ran, the branch, the note file and the open pull request, prints a stage table, and cleans up the
  pull request, the `agent/*` branches, its processes and its temp folder, also on failure. Refuses repositories whose
  name doesn't say throwaway. `TECHTEAM_DIST_DIR` moves Next's build folder (default `.next`).
- **The agent sandbox on your own Docker.** With no `SANDBOX_DOCKER_HOST`, the sandbox (the Developer's and the
  Tester's `run_tests` / `run_build` / `run_command`, PR previews, the Tester's browser) runs on the Docker of this
  computer: Docker Desktop on Windows or macOS, Docker Engine on Linux. No VPS, Caddy or domain. `npm run sandbox:setup`
  downloads the sandbox image and builds the browser image once (`-- --check` only reports; refuses a remote host
  unless `-- --remote`). Previews are served at `http://127.0.0.1:<port>` (loopback only) through a small forwarder
  container next to the `--internal` preview network. A remote host keeps working exactly as before.
- **Settings → Sandbox says why it can't run**: Docker not installed, Docker Desktop not running, Docker in
  Windows-containers mode, or the images missing, each with the fix. The card streams in, so Settings never waits for
  Docker; the answer is cached for 15 s. `TECHTEAM_SANDBOX=off` switches the sandbox off on a computer.
- **Allow install scripts (some packages need them)** in Settings → Sandbox (local mode, off by default; stored in the
  existing `sandbox_commands` JSON, no migration). Without it, local installs run with `--ignore-scripts`.
- `npm run doctor` reports the Docker engine (not installed, stopped, Windows containers, ready) and whether the sandbox
  images are installed, as information only.

### Removed
- **The schema nothing uses any more** (migration `0020_drop_unused_schema`): the tables `ai_provider_keys`,
  `switch_connections` and `trust_scans`, and the columns `users.auth_user_id`, `workspaces.ai_provider` and
  `agents.switch_agent_id`. New users no longer get a `github:<id>` auth id. **Upgrade: run `npm run backup` first. This
  migration deletes the data in these tables, which nothing uses.** Backups made by v0.9.0 and earlier still restore:
  rows of the dropped tables are skipped with a warning (`RETIRED_TABLES`), dropped columns are ignored.

### Changed
- Every `docker` argument list is built in `lib/sandbox/docker-args.ts` and one test checks them all in both modes: no
  `--privileged`, Docker socket, host-path mount, host network, added capability, device or user but the unprivileged
  one, and no secret in a container. Local containers drop gVisor (the default runtime applies; on Docker Desktop they
  live in its Linux VM), pin `host.docker.internal` and `gateway.docker.internal` to `127.0.0.1`, and never pull images.
- The `docker` CLI is spawned with a tiny environment (`lib/sandbox/docker-env.ts`): on Windows what Docker Desktop's
  CLI needs, never `DOCKER_HOST` locally and never the app's secrets.
- `sandboxAvailable()` and `previewsAvailable()` are async. Link captures stay remote-only (their safety rests on the
  host firewall rules), with the reason shown where links are added.
- The sandbox browser image is now `techteam-browser:1.64.1-4`: in local mode Chromium's own sandbox is off (the default
  runtime can't run it with capabilities dropped; the container is the boundary). Run `npm run sandbox:setup` again.
- Phase 8 of the local-first plan is done with Docker; WSL2 + bubblewrap is dropped from it.

## [0.9.0] — 2026-11-24

TechTeam now runs on your own computer, for one user. The remote services of the hosted design (sign-in service, S3,
Cloudhike Jobs, Switch Trust, the tunnel) are gone; GitHub and the model providers you choose are all that is left.
Plan: [docs/local-first-plan.md](docs/local-first-plan.md). This release also carries **v0.8** (agents on your Claude
plan and the live model catalog), which was never released on its own. **Existing installations**: run
`npm run db:migrate` (migrations 0016 to 0019), then see
[docs/setup.md](docs/setup.md#coming-from-the-hosted-version).

### Added
- **Local-first.** `git clone`, `npm install`, `npm run dev` brings up everything. With `DATABASE_URL` unset it starts
  an **embedded Postgres 18** (no Docker, no install; about 110 MB downloaded with `npm install`), creates the database
  and applies the migrations. Data lives in one folder, `~/.techteam/data` (`TECHTEAM_DATA_DIR`): the database on
  `127.0.0.1:54329` (`TECHTEAM_PG_PORT`), the files, and generated secrets. Setting `DATABASE_URL` keeps the old
  behavior. `npm run db:local` runs the database alone.
- **Sign in with GitHub.** One GitHub sign-in (OAuth device flow: you type a code on github.com; or a personal access
  token) is both your identity and repository access. The OAuth App needs no client secret: its public client id is
  built in (`GITHUB_CLIENT_ID` overrides it). Sessions are a signed cookie (`tt_session`) with a secret generated in your
  data folder. The first sign-in on a database with exactly one user asks once whether to **adopt** that user's data with
  your GitHub account (migration 0018 adds `users.github_user_id`).
- **`npm run backup` and `npm run restore`**: one `.tar.gz` with your database (read only, one consistent snapshot) and
  files, restored into an empty database in one transaction. No secrets are included: sign in with GitHub and enter your
  AI keys again after restoring. `--with-s3` also collects the old S3 bucket, so the old remote data can be carried over
  as one file; `npm run storage:import-s3` copies old files from the bucket once. See docs/setup.md.
- **`npm run doctor`** checks this computer (Node, git, tar, data folder and disk, ports, database and migrations, app
  address, encryption key, GitHub sign-in, Claude Code, Docker/WSL, obsolete `.env` settings) and prints a fix for each
  problem. `--json` for scripts. It never prints a secret or a value from `.env`.
- **`npm run start:local`**: the stable way to leave agents working. One terminal runs the production build (built first
  when the code changed), the embedded database and the Inngest Dev Server; Ctrl+C stops all three. `TECHTEAM_PORT` and
  `TECHTEAM_INNGEST_PORT` move the ports.
- **A "Get started" checklist.** The Overview shows what is left before agents can work (an AI route: an API key or
  Claude Code on your plan; a workspace) with a link to Settings → AI, until everything is done. A user without a
  workspace sees a short "Before you start" version above the create form.
- **Runs interrupted when TechTeam stopped are ended.** A run left `running` after the app or the Inngest Dev Server
  stopped mid-run no longer blocks its card for ever: every 5 minutes (`run-sweep`), a run with no sign of life for 30
  minutes (and not waiting for your plan) is failed as "Interrupted when TechTeam stopped", the card is released and the
  bell says to press Run, which continues the same branch.
- **Choose the order companies fall back in.** Settings → AI → This workspace only lists your companies with move up and
  move down buttons: when one runs out of credit, or your Claude plan runs out with "Switch company", agents go to the
  first company in that order with a key (default: OpenAI, Anthropic, OpenRouter). New column
  `workspaces.ai_fallback_order` (migration 0019).
- **Agents on your Claude plan** (only when TechTeam runs on your computer): Settings → AI → *Plans on this computer*
  routes the agents on Claude models through **Claude Code** signed in with your own plan, instead of an Anthropic API
  key. Agents keep their model; the route is per computer. TechTeam uses its own Claude Code login
  (`~/.techteam/cli/claude`), separate from the one you use in your terminal; you confirm the account once and every
  stage checks it. Agents still work only through TechTeam's tools (a local MCP endpoint), with the same permissions,
  agent log, references, skills and sandbox. Plan stages record turns and tokens plus the API-equivalent cost as a
  reference, never as spend, and budgets don't apply to them. See [docs/cli-agents.md](docs/cli-agents.md).
- **When the plan runs out**: wait for the reset and resume the same session (the card says when), continue on the API
  key, or switch company (auto failover). A model the plan refuses is remembered on that computer and takes the API key
  (or the stage stops with the reason).
- AI Team cards show each agent's route on this computer ("Your Claude plan" / "API key"); spending tiles, the run log
  and Metrics say **API** spend, and Settings shows this month's plan usage.
- `AGENTS_AUTO_PICKUP=false` keeps auto pickup off on one computer; a card can have only one run in flight, whichever
  computer starts it (database guard).
- **Live model catalog**: each company's models come from OpenRouter's public model list (no key, no spend), stored in
  the database (`model_catalog`, migration 0017) and refreshed daily or with Settings → AI → **Refresh models**. AI
  Team's model picker shows each company's current models with tier, vision and price per 1M tokens (or *Your plan*),
  so new models can be picked without a code change. Offline before the first fetch, the app uses a built-in list. See
  [docs/model-catalog-plan.md](docs/model-catalog-plan.md).
- CI also runs `npm run check` on Windows.

### Changed
- **The app listens on `127.0.0.1` only** (`npm run dev:app`, `npm start`), refuses requests for any other host name
  (DNS-rebinding guard) and calls itself at `127.0.0.1` (Inngest, the agents' MCP endpoint).
- **Files are stored on your computer**, not in an S3 bucket: workspace logos, the Tester's screenshots and card
  references live in `~/.techteam/data/files`. The `S3_*` variables are gone and logo and reference uploads are always
  available.
- **The encryption key is generated for you**: unset, `TOKEN_ENCRYPTION_KEY` falls back to
  `<TECHTEAM_DATA_DIR>/encryption.key`. Keep that file with your backups: moving to another computer without it means
  entering the AI keys again. An existing `TOKEN_ENCRYPTION_KEY` keeps working.
- **One command for local development**: `npm run dev` starts the database, the app and the Inngest Dev Server together
  in one terminal (`concurrently`; stopping one stops all). `npm run dev:app` starts only the app, `npm run inngest:dev`
  only Inngest. The app is pinned to port 3000 so a busy port fails loudly instead of leaving Inngest pointed at the
  wrong address.
- **Settings → Your account shows your GitHub identity**: avatar, name, `@login`, "Signed in with GitHub", member since,
  last sign-in and a **Sign out** button. The "Verified email", email and account id rows are gone. The separate
  "Connect GitHub" step is now "Reconnect GitHub" and leads to sign-in.
- **The Sandbox section is one line without a sandbox host.** No dead switches, commands or buttons, and `package.json`
  isn't read from GitHub. With a host, it is unchanged. The sandbox stays optional and still needs a Docker host.
- **`.env.example` is minimal.** It sets only `NEXT_PUBLIC_APP_URL`; every other setting is optional and documented in
  [docs/setup.md](docs/setup.md). A copied placeholder (`your_openai_api_key`, `preview.example.com`) used to count as a
  real key or domain.
- Models are data, not code: the hand-written `AGENT_MODELS` list is gone. Only current models are offered (the newest
  of each family); an agent on a model that left the list keeps running on it, shown as *older*. Role defaults are a
  tier (balanced, the Tester fast) resolved to each company's current model, so new OpenAI agents start on GPT-6.1
  Terra instead of GPT-6.1 Sol (existing agents keep their model). Tiers rank each company's models by output price.
  API costs use the catalog's prices; request knobs (effort levels, verbosity) come from the catalog, with the
  hand-checked levels kept as overrides.

### Removed
- **The hosted services.** Email/password and Google sign-in, the sign-up page, the web OAuth flow
  (`/api/github/connect` and `/callback`), the session cache and the user mirror; **Switch Trust** (SwitchAgent scans:
  the Settings card, scan buttons, weekly scans and the endpoints Switch called; the Trust Score keeps its rule-based
  scan and the optional AI review, **Scan again**); **Cloudhike Jobs** and `PUBLIC_APP_URL` (nothing calls the app back
  from the internet, so no tunnel); **S3**. `AUTH_URL`, `AUTH_PUBLISHABLE_KEY`, `AUTH_SECRET_KEY`,
  `GITHUB_CLIENT_SECRET`, `S3_*`, `JOBS_API_URL`, `JOBS_API_KEY`, `PUBLIC_APP_URL` and `SWITCH_AGENT_AI_API_KEY` are no
  longer read and can be deleted from `.env` (`npm run doctor` lists them). The unused tables and columns
  (`users.auth_user_id`, `switch_connections`, `trust_scans`, `agents.switch_agent_id`) stay until a cleanup migration.
- **Workspace API keys.** Settings → AI → This workspace only no longer has "Workspace keys (optional)": AI keys live on
  your account (or the environment), and nothing reads or writes `ai_provider_keys` any more.
- **Multi-computer notices in Settings** ("Off on your other computers…", the `AGENTS_AUTO_PICKUP=false` note under
  Agent automation): each computer has its own database. The variable still works for computers that share a Postgres.

### Fixed
- **Agents work under `npm start`.** The Inngest SDK took a production build for Inngest Cloud and never reached the
  local Dev Server. Without Inngest Cloud keys the app now always uses the Dev Server.
- **The Inngest Dev Server is pinned** (1.53.0) instead of downloading the latest at every start, and listens on
  127.0.0.1 only (`inngest:dev` and `start:local`; it listened on every network interface).
- **A secret that can't be read no longer breaks the app.** After the encryption key changed or was removed, every saved
  AI key and GitHub token became undecryptable and the board answered 500 (Settings too, so the keys couldn't be
  entered again). Such a secret now counts as not set: Settings shows "The saved key can't be read, probably because
  the encryption key changed. Enter it again." on that key (saving replaces it), and an unreadable GitHub token is
  treated like an expired connection (sign in again).

## [0.7.0] — 2026-11-20

### Added
- **References on a card**: attach images (PNG, JPEG, WebP), Markdown or text files and PDFs in the card dialog's
  References section, several at once, for any saved card (GitHub cards too). Up to 10 per card; images up to 5 MB and
  8000 × 8000 px, text up to 1 MB, PDFs up to 5 MB. Files are checked by their content (an SVG or a renamed file is
  refused), kept in the private bucket and opened through an owner-only link. A PDF's text (up to 100 pages) is
  extracted once at upload; a scanned PDF says it has none. The board card shows a paperclip with the count. Removing
  the card deletes its references.
- **Agents read references** with two read-only tools in every stage, `list_references` and `read_reference`: text and
  PDF text in pages, images as image input on OpenAI, Anthropic and OpenRouter (sent as base64 from private storage,
  never a link). The Analyst's brief names the references the Developer must follow; the Developer follows them, and
  the Reviewer, the Lead and the Tester can check the work against them. References are the owner's requirements but
  still data for the operating protocol. Simulated agents list and read the first reference.
- Every model in AI Team → Configure is marked as seeing images or not. **Run** (and auto pickup) refuses a card with
  images when the Analyst's or the Developer's model can't see them (DeepSeek V4 Pro, GLM 5.3), with a link to the AI
  Team page. Models are never switched for you.
- **Links as references**: paste a public http(s) address under References → **Add a link**. The sandbox browser
  captures the page once, right then (10–30 s): a desktop (1280 px) and a mobile (375 px) screenshot and a short
  outline of the page (headings, navigation, buttons, main texts, fonts and colors). The row shows the desktop
  thumbnail, the domain (opens the original page) and the mobile screenshot. Agents read the capture like any
  reference, framed as a third-party page to take structure and style from, never its logos, brand names, images or
  texts; they never browse the internet. Private and internal addresses are refused, including through redirects and
  the page's own requests (see docs/security.md). Needs a sandbox host; without one the input is disabled.
- **The Tester compares the preview with the references**: `browse_preview` gets a tablet viewport (768 px) and a
  light or dark color scheme, and a Tester whose model sees images now gets its own screenshots as image input. On a
  card with images or links it browses each changed page at the reference's size, light and dark, and fails the card
  with the specific differences when the preview clearly doesn't match what the brief says to follow.
- With previews on, Run's vision check also covers the **Tester** for cards with images or links.
- **Built-in design skill `interface-design`** (Dammyjay93/interface-design, MIT, pinned to `2f9be32`; one on-demand
  practice file), on for the Developer and the Tester in every workspace, new and existing (one you switch off stays
  off). Visual hierarchy, spacing and type scales, tokens, interactive and data states, hit areas and dark mode, using
  the project's own design system first. Its usage note tells agents to treat a rough image or spec as content and
  intent, not pixels to copy, and gives the Tester its checks for the preview.

- **`add_dependency`**: with the sandbox on, a Developer with *Manage dependencies* (and *Write code*) adds an npm
  package in one call. npm resolves it in the sandbox (`npm install --package-lock-only --ignore-scripts`: no
  tarballs downloaded, no install scripts run) and package.json and the lockfile are committed to the branch together
  through the GitHub API, so `npm ci` keeps working in CI and in the sandbox. Name and version are validated (npm
  names; an exact version, one simple range or latest; no URLs, git, paths or tags). pnpm, Yarn and Bun repositories
  are refused with a message. The Developer's protocol says a font the card names is added as a bundled package
  (`@fontsource/…`) and imported, never linked from a font host, so it loads in the preview; agents don't pick fonts
  on their own. Draft with AI mentions the tool when the Developer has it.
- **Agents fix merge conflicts**: the Developer brings the default branch into its pull request's branch with
  `merge_default_branch`, as a real merge commit (two parents), so GitHub sees the pull request as mergeable again.
  Without conflicts GitHub merges it in one call. With conflicts, files whose changes don't overlap merge
  automatically, lockfiles take the default branch's version (re-add packages with `add_dependency`), and the rest
  are resolved one by one: `read_conflict` shows the file with conflict markers (your branch, the merge base, the
  default branch), `resolve_conflict` takes the whole merged file (leftover markers are refused) and `finish_merge`
  commits the merge, only if neither branch moved meanwhile, or aborts it. Protected paths, links, submodules, binary
  or large files, manifests without *Manage dependencies* and more than 20 conflicts are refused with a message for the
  owner. Nothing is cloned and file contents are never stored: the open merge keeps only commit and blob shas.
- **Running the Tester's follow-up card fixes the pull request** ("Fix merge of PR #n", filed when a merge is blocked by
  a conflict or a failing build): the run continues on that PR's branch instead of opening a new one, its brief names
  the original card and why the merge failed, and for a conflict the Developer starts with `merge_default_branch`.
  Reviews, the Lead and the tests run again; the merge (manual or automatic) moves both cards to Done. Auto pickup does
  the same. Running the original card again while its PR conflicts gets the same brief.

- **A stage no longer loses its work to the turn limit.** Three turns before the end an agent is told to wrap up, and
  the last-turn message (every provider) asks the Developer to submit what's done with `complete: false` and a precise
  `remaining_work` list. An unfinished result opens or updates the pull request as usual; the Reviewer, Security and
  the Lead see what's left (the PR body lists it under "Not finished yet"), and the Lead sends it back for another round
  on the same branch with a full set of turns. A Developer that still ends its last turn without a result, with commits
  on the branch, goes on the same way with a result the pipeline writes (files from GitHub's compare, "ran out of
  turns"); without commits (or a rework round with no new commit) the run stops as before. A Reviewer or Security that
  runs out of turns becomes a missing check for the Lead, and raises the minimum risk to medium; the Analyst, the Lead
  and the Tester still stop the run (there's no decision to make up).
- **A rerun continues an unfinished branch**: when the card's previous run stopped with commits on its branch and no
  pull request (out of turns, budget, Stop), the next run works on that branch instead of a new `…-r<run>` one, and the
  Developer's brief lists what's already there.
- Stage activity shows tool calls next to turns ("12 turns, 31 tool calls"), so batching can be measured.

### Changed
- **Lighter requests per turn.** OpenRouter agents fold older turns into a short digest (one line per tool call: what,
  where, first line of the result) once the turns since the last fold pass ~100K characters, keeping the last two turns
  verbatim with their reasoning; stored conversations stay verbatim. On run 53's stored conversation this cuts what the
  40 turns resent by 76% (12.4M → 2.9M characters; two thirds of it was DeepSeek's reasoning, which its hosts require
  sent back). Claude uses Anthropic's server-side context editing past 150K input tokens (clears old tool uses, keeps
  thinking blocks valid); OpenAI uses the Responses API's server-side compaction past 120K tokens.
- **Terser, batched turns**: the stage protocol asks every agent to batch independent tool calls in one turn, with no
  prose in between; the Developer edits with `replace_in_file` rather than rewriting files, reads line ranges of big
  files and runs tests after a batch of edits. The Lead runs at low reasoning effort on every model that accepts it;
  OpenAI agents outside development ask for low verbosity. Parameters go only to models known to accept them
  (`lib/agent-request-params.ts`): OpenRouter would otherwise find no host (`require_parameters`).
- The Tester's pre-checks include **Merges cleanly into the default branch**: a pull request GitHub reports as
  conflicting fails the tests and goes back to the Developer (who can now merge), instead of failing later at merge.
- The follow-up card's description and the "couldn't be merged" notification say that running the card fixes the
  pull request. The pull request's last merge error stays until the run that took it over pushes its work.
- The sandbox browser image is now `techteam-browser:1.64.1-3` (link captures, tablet, color scheme, and fonts with
  real bold weights): rebuild it on the sandbox host (docs/sandbox.md). `system-ui` and the usual UI font stacks render
  in Inter (100–900) and `serif` / `monospace` in Liberation Serif / Mono; before, `system-ui` headings and 700-weight
  text showed as regular in the Tester's screenshots and link captures.
- `deploy/setup.sh` creates the link-capture and install networks and adds firewall rules that keep both off private
  ranges: run it again on the host.

### Fixed
- A run that continues a pull request gets the Lead's required changes from the earlier run on that branch when that
  run ended before making them (live run 54 was stopped mid-rework; run 55 had to find the same issues again).
- A Developer without *Manage dependencies* no longer loads a font the card names from a font host: it keeps the
  existing fonts and says the permission is needed (live run 55 added a Google Fonts `<link>`, which fails in previews).
- OpenRouter agents' last turn offers only the stage's finish tool. Models ignored the last-turn message and kept
  editing (live run 53: DeepSeek V4 Pro used its 40th turn on another edit), so the stage ended without a result.

### Security
- The sandbox's install step (unpack + install dependencies, the only step with network; previews too) runs on its
  own network, `techteam-sandbox` (`172.31.252.0/24`, no traffic between containers), instead of Docker's default
  bridge, where containers could reach the hosting provider's private network. `deploy/setup.sh` refuses its traffic
  to private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved ranges, as for link captures. The
  app creates the network on first use and gives installs public DNS resolvers (Docker's own doesn't answer under
  gVisor). Needs Docker 26 or later on the sandbox host.

### Database
- Migration `0013_card_references`: `task_references` (one small row per reference: kind, name, type, size, S3 keys,
  PDF pages and text length, image size; files and PDF text live in S3; additive).
- Migration `0014_card_reference_links`: `task_references.source_url` and `mobile_key` for link references (additive).
- Migration `0015_pending_merge`: `agent_runs.pending_merge` (jsonb), the Developer's open merge (additive).

## [0.5.0] — 2026-11-19

Agents run the code: a sandbox for tests and builds, a live preview of each pull request that the Tester tries in a
browser, AI keys on your account and OpenRouter as a third company.

### Added
- **Live previews of agent pull requests**: with Settings → Sandbox → Previews on, each agent PR
  gets its app running at `https://pr-<n>-<random>.<SANDBOX_PREVIEW_DOMAIN>` once CI passes, served with HTTPS by Caddy
  on the sandbox host. The preview has no internet and stops when the PR is merged or closed, the run is stopped or
  replaced, or after 2 hours. **View preview** on the card's ⋯ menu and on the Pull Requests page. The preview command
  is detected from `package.json` (Vite, Next.js or a `start` script) and editable.
- **The Tester tries the preview in a browser** (`browse_preview`): a headless Chromium on the preview's private
  network opens pages, clicks, fills forms and waits for results, on desktop or mobile, and reports the status,
  console and page errors, failed requests and an outline of the page. Each call's screenshot shows in the agent log.
- **OpenRouter as a third company** (Settings → AI providers): one key and one credit balance for models from Google
  (Gemini 4 Argon, Gemini 4 Hydrogen, Gemini 3.8 Flash), DeepSeek (V4 Pro, V4.1 Flash), Z.ai (GLM 5.3, GLM 5.3 Flash),
  xAI (Grok 4.7, Grok Build 0.1) and Moonshot (Kimi K3.1 Pro). Pick them per agent in AI Team → Configure, grouped by
  maker. Requests only go to hosts that don't keep or train on prompts, support tools and aren't 4-bit quantized; the
  cost logged is the one OpenRouter reports. Out of credit on OpenRouter stops or switches like the other two.
- **AI keys on your account** (Settings → Your account → AI keys): save an OpenAI or Anthropic key once and every
  project you own uses it. A workspace can still have its own key, used only for a company the account has no key
  for; the account's key always wins. Existing workspace keys moved to their owner's account.
- **Company and model per agent**: in AI Team → Configure, pick the agent's company (OpenAI or Anthropic), then a model
  from it. A team can mix both: a cheap model for one agent, a strong one for another. Every company with a key is
  available.
- **Spending this month** across every project (Settings → Your account): the total, by project and by agent. Each
  project keeps its own spend on its AI Team page.
- **Agent sandbox**: with Settings → Sandbox on, the Developer and the Tester run the repository's
  tests, build or one command (`run_tests`, `run_build`, `run_command`) on the branch's latest commit, in throwaway gVisor
  containers on a Docker host. Dependencies install with network; the code runs without. The Developer fixes what fails
  before review; the Tester runs the tests itself. Commands are detected from `package.json` and editable; **Test the
  sandbox** checks the setup. The agent log shows each command and its outcome. See `docs/sandbox.md`.
- **VPS setup script** (`deploy/setup.sh`): prepares a fresh Ubuntu 24.04 server for agent sandboxes (updates,
  firewall, swap, Docker with ports bound to localhost by default, gVisor, a `techteam` user). Idempotent;
  `--lock-ssh` turns off password and root logins.
- `deploy/setup.sh` also runs Caddy for previews and refuses traffic from Docker bridges to the host itself, so no
  container (preview, browser or install) can reach the host's SSH. `deploy/browser/` is the browser image.
- `.gitattributes` keeps LF line endings in the repository, so scripts committed from Windows still run on the VPS.

### Changed
- Moving an agent to another company (out of credit, or changing Company) keeps its model's tier — flagship,
  balanced, efficient or fast — instead of a fixed OpenAI ↔ Anthropic map. The automatic switch and **Switch and
  retry** go to the first other company with a key: OpenAI, Anthropic, then OpenRouter.
- **Draft with AI** and AI trust reviews use OpenRouter (DeepSeek V4 Pro) when there's no OpenAI or Anthropic key.
- Settings is split into **Your account** (profile, **AI providers**, spending) and **This workspace** (details,
  automation, sandbox, Switch Trust, skills). **AI providers** holds your keys plus, under "This workspace only", the
  automatic switch and optional workspace keys; it no longer switches the whole team between companies.
- The account menu has one **Settings** item instead of three links into the same page.
- Out of credit, the board's retry and the automatic switch move only the agents on the company that ran dry.
- The stage protocol follows what an agent can do: with the sandbox tools the Developer runs the tests and the build
  and fixes what broke before handing off, and the Tester runs them itself and fails the card when they fail. The
  Reviewer and the Lead are told they can't run code.
- **Draft with AI** says an agent runs tests and builds only when it really can (Developer or Tester, *Run tests in a
  sandbox*, sandbox on); otherwise it still says the agent can't run code.

### Database
- Migration `0012_agent_run_preview`: `agent_runs.preview` (jsonb: the run's preview host, status, round, commit and
  times; additive).
- Migration `0011_sandbox_preview`: `workspaces.sandbox_preview` (boolean, default false) and
  `agent_run_steps.screenshot_key` (text, the S3 key of a browser screenshot; additive).
- Migration `0010_account_ai_keys`: `user_ai_keys` (one encrypted key per user and provider); moves every workspace
  key to its owner's account (the newest per provider) and deletes the workspace copies.
- Migration `0009_sandbox`: `workspaces.sandbox_enabled` (boolean, default false) and `workspaces.sandbox_commands`
  (jsonb: install, test and build commands; additive).

## [0.4.0] — 2026-11-18

CI in the loop and a Metrics page.

### Added
- **CI in the loop**: after each push the pipeline waits for the pull request's checks (up to 15 minutes) before
  review. A check the change broke goes back to the Developer with its annotations and the end of its job log, as a
  rework round; checks that fail on the default branch too don't block, and a repository without CI moves on. Cards
  say "Waiting for CI on PR #n…", the agent log has a **CI checks** block per round, the live process waits in
  Development, and the Lead and the Tester see the result.
- **Metrics** page (sidebar): delivered cards and success rate, first-pass rate, CI pass rate, cost per delivered card
  (failed runs included), outcomes, why work went back (CI, Lead, tests), spend by agent and recent runs, over 7, 30 or
  90 days.

### Fixed
- Automatic provider switch: when the second company is out of credit too, the run stops with "out of credit" instead
  of switching the team back to the first one (which had just run dry) and announcing that the card carried on.
- Auto pickup now logs "Picked up AJU-n" in the activity feed, like Run does.
- Draft with AI no longer promises that an agent runs tests or code: agents work through the GitHub API only.

### Changed
- Board columns scroll on their own: the board fits the screen and a long column scrolls under its title and count
  instead of stretching the page. Each column shows its first 5 cards with **Show N more** (and **Show less**); a
  search shows every match.
- The Lead's default model is GPT-6.1 Sol / Claude Sonnet 5.5 instead of GPT-6 Astra / Claude Opus 5.5. In the first
  real run with skills the Lead on Astra was 38 % of the cost while it only decides on the two reviews. Existing
  workspaces keep their choice.

### Removed
- The deprecated `workspaces.agent_auto_merge` column (replaced by the merge mode in 0.2.0).

### Database
- Migration `0007_drop_agent_auto_merge`: drops `workspaces.agent_auto_merge`.
- Migration `0008_ci_gate`: `agent_runs.ci` (jsonb, the CI result of each development round; additive).

## [0.3.0] — 2026-11-17

Agent skills: knowledge your agents search and read while they work.

### Added
- **Agent skills**: knowledge packs in the Agent Skills format (a folder with SKILL.md plus reference files) that
  agents search and read while they work. Technical or practice; always loaded (playbook in the prompt, ≤ 8 KB) or on
  demand. Never executed.
- **Built-in skills**, vendored at a pinned commit with their license and a `SOURCE.md`: `modern-web-guidance`
  (Google Chrome, Apache-2.0; on for the Developer, Reviewer and Security) and `chrome-extensions` (off by default).
  `npm run skills:sync` updates them from GitHub as a reviewable diff.
- **Settings → Agent skills**, its own page (also in the account menu; Settings shows a summary card): **Upload
  skill** opens a dialog to upload a SKILL.md or a .zip, see the security scan and the suggested type, load and
  roles, and confirm who uses it. The library has a search and an agent filter, and shows each skill's origin,
  license, scan and agents, with Assign, New version and Delete.
- **Skills panel** in AI Team → Configure: lists only the skills the agent has on, each with a switch (saves at
  once), and **Add a skill** searches the rest of the library, recommended ones for the role first; a warning shows
  when a skill assumes a permission the agent lacks.
- Two agent tools in every stage, `search_skill` and `read_skill`, on OpenAI and Anthropic; shown in the agent log
  and the live process. Simulated agents use them too.
- Security scan for uploads (prompt injection, credentials, secret exfiltration, pushing to the default branch,
  disabling tests or CI, sending data to URLs, hidden instructions, encoded blobs) plus an AI review when a provider
  key exists; critical findings block the install. Enabled uploaded skills' findings count in the trust score.

### Changed
- What the app called **skills** (Read repository, Write code, Merge pull requests …) are now **permissions** in the
  UI and the code. The database column `agents.skills` keeps its name.
- *Skill Trust Score* is now **Trust Score**. Agent cards show *Permissions · N* and *Skills · N*.
- Agent cards on AI Team put the agent's name and specialty beside its face, one row shorter.
- Switch Trust evaluations include the agent's always-loaded skills in its prompt.
- Server Action body limit raised to 6 MB for skill uploads.

### Database
- Migration `0006_agent_skills`: `agent_skills`, `agent_skill_files`, `agent_skill_assignments` (additive).

## [0.2.0] — 2026-11-16

Smarter gates and a live view of the pipeline.

### Added
- **Security** and **Lead** agents. Security reviews every pull request for leaked secrets, injection, unsafe
  permissions and risky dependencies. The Lead combines both reviews, decides whether the Developer reworks, and rates
  the change's risk (low, medium, high) with reasons. Both are read-only by default and are created automatically in
  existing workspaces.
- Pipeline: Analysis → Development → Review (Reviewer and Security **in parallel**) → Approval (Lead) → Testing →
  Merge. The board keeps six columns: approval holds the card in In Review.
- **Risk-based merging**: Settings → Merging offers Manual, **Automatic when low risk** and Automatic. The risk can't be
  rated below what the facts show: Security's findings and what the diff touches (dependencies, schema, auth, CI, size).
- Pull Requests show the Lead's risk next to the approval and test verdicts. The bell says why a pull request waits.
- **Live process** on the AI Team page: the six steps of each card in flight, with who works, what they're doing, their
  last three actions, turns and cost so far, and each finished step's result. "Inactive" when nothing runs.
- **Face avatars** for every agent (AI Team, board cards, Overview, activity, agent log). Agent cards show what a
  working agent is doing.

### Changed
- The Lead's decision, not the Reviewer's, sends work back to the Developer and sets the pull request's review status.
- The agent log shows the parallel Code review and Security review blocks, both live at once.
- AI Team cards sit three per row on wide screens.
- Existing workspaces keep their merge setting: automatic merging stays "Automatic" (any risk).

### Removed
- The Live Agent Office (replaced by the live process), its sprites and the `office:assets` script.

### Security
- Next.js 16.4.4 → 16.4.6: 16.4.4 is affected by a published security advisory (`next upgrade --agent=security`).

## [0.1.0] — 2026-11-16

The MVP: a workspace linked to one GitHub repository, its issues on a Kanban board, and a team of four AI agents that
takes a card from analysis to a merged pull request, with cost, trust and human control built in.

### Added

**Accounts and workspaces**
- Email/password, GitHub and Google sign-in (hosted Better Auth on CloudHike); sessions in an HTTP-only cookie, cached
  for 60 s against the auth service's rate limit.
- Workspace creation with a name, an icon or uploaded logo (private S3) and exactly one linked GitHub repository
  (separate OAuth App, tokens encrypted with AES-256-GCM).
- Dashboard shell: collapsible sidebar, workspace switcher, light/dark/system theme, notifications bell.

**Board**
- Six columns (Todo, Analysis, In Development, In Review, Testing, Done) with drag and drop (mouse, touch, keyboard),
  search, type filters and a create/edit dialog.
- GitHub issue sync: open issues become cards; closing an issue moves its card to Done.
- Card actions: **Run**, **Stop agents**, **Merge**, **Answer the analyst**, **View agent log**, **Remove task**.

**Agent pipeline**
- Analyst → Developer (branch + pull request) → Reviewer → Tester → merge, as Inngest jobs (one step per model turn).
- Skills enforced as tools; agents never write `.github/workflows/`, `.env*` or `.git/`, and never merge themselves.
- Rework rounds when review or tests fail (at most 2), with converging re-reviews; manual-only checks never block.
- The analyst can ask a question; the owner answers on the board, the answer is posted on the issue and kept for later runs.
- Rerun on the same branch and PR; a PR closed on GitHub stops the card and a rerun starts a new branch.
- Merge manually or automatically (review + tests + green CI); a blocked merge makes the Tester file a follow-up card.
- Optional auto pickup of never-run Todo cards.
- Agent log per card: stages, tool calls, files changed, cost, and how each stage ended.

**AI Team**
- Four agents per workspace with configurable instructions, skills, model, monthly budget, max turns and pause.
- **Draft with AI** for instructions tailored to the repository; Skill Trust Score (rule checks + optional AI review).
- Monthly spending per agent from real model usage; activity drawer; Live Agent Office.

**Providers**
- OpenAI and Anthropic models, one company per workspace, a remembered model per agent per company.
- Workspace API keys, verified with the provider and encrypted; server keys as a fallback.
- Out of credit: the run stops with a one-click switch and retry, or switches automatically (opt-in).

**Switch Trust**
- Connect a Switch account (key encrypted, tenant and workspace detected from it).
- SwitchAgent scans: each agent is registered in Switch and scored by **one** evaluation (the cheapest built-in), on
  connect, weekly (opt-out) and on demand. Health score, tests held and OWASP coverage on the AI Team page.
- Scans run in the background on Cloudhike jobs; Switch reaches each agent through an OpenAI-compatible endpoint with a
  derived per-agent credential. Monthly budgets are sent as Switch cost caps.

**Overview, Activity, Pull Requests**
- Overview and Activity on real data: agent work and people's card creations, moves, edits and removals.
- Pull Requests page with review and test verdicts and **Merge**.

**Engineering**
- Strict TypeScript, ESLint 9, Vitest (58 unit tests), Drizzle migrations `0000`–`0004`.
- CI on GitHub Actions: `npm run check` (typegen, tsc, lint, tests) and `npm run build` on every push and PR.
- Documentation in `docs/` and contributor conventions in `AGENTS.md`.

### Verified live

- OpenAI pipeline end to end, needs info and answer, rework, rerun on the same PR, merge and close on GitHub.
- Switch scan of four agents (score 99 each, about 3 minutes, $2.09).
- Details and the full test plan: [docs/testing.md](docs/testing.md).

### Known limitations

- Agents can't run code: verification is static review plus CI.
- Not deployed. Switch evaluations and weekly scans need a public URL (a tunnel such as ngrok until then).
- Deferred to post-MVP testing: Anthropic live run, blocked merge, auto pickup and auto merge end to end, pause or
  budget mid-run, Draft with AI with a real key, automatic provider switch.
- Switch shows caps but not spend until usage is reported through the Switch SDK.

[Unreleased]: https://github.com/johanso/techcrew/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/johanso/techcrew/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/johanso/techcrew/compare/v0.7.0...v0.9.0
[0.7.0]: https://github.com/johanso/techcrew/releases/tag/v0.7.0
[0.5.0]: https://github.com/johanso/techcrew/releases/tag/v0.5.0
[0.4.0]: https://github.com/johanso/techcrew/releases/tag/v0.4.0
[0.3.0]: https://github.com/johanso/techcrew/releases/tag/v0.3.0
[0.2.0]: https://github.com/johanso/techcrew/releases/tag/v0.2.0
[0.1.0]: https://github.com/johanso/techcrew/releases/tag/v0.1.0
