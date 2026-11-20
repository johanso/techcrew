# Changelog

Notable changes per version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/): `0.x` while TechTeam isn't deployed to production.

Add each change under **Unreleased** in the same pull request. A release moves those entries under a new version
heading. See [Releasing](docs/roadmap.md#releasing).

## [Unreleased]

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

### Changed
- The sandbox browser image is now `techteam-browser:1.64.1-3` (link captures, tablet, color scheme, and fonts with
  real bold weights): rebuild it on the sandbox host (docs/sandbox.md). `system-ui` and the usual UI font stacks render
  in Inter (100–900) and `serif` / `monospace` in Liberation Serif / Mono; before, `system-ui` headings and 700-weight
  text showed as regular in the Tester's screenshots and link captures.
- `deploy/setup.sh` creates the link-capture and install networks and adds firewall rules that keep both off private
  ranges: run it again on the host.

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

[Unreleased]: https://github.com/jricardomillion/techcrew/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.5.0
[0.4.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.4.0
[0.3.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.3.0
[0.2.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.2.0
[0.1.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.1.0
