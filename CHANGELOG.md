# Changelog

Notable changes per version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/): `0.x` while TechTeam isn't deployed to production.

Add each change under **Unreleased** in the same pull request. A release moves those entries under a new version
heading. See [Releasing](docs/roadmap.md#releasing).

## [Unreleased]

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

[Unreleased]: https://github.com/jricardomillion/techcrew/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jricardomillion/techcrew/releases/tag/v0.1.0
