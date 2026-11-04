# Testing the agents

How to exercise the AI agent features end to end, what has been verified and what hasn't, and the tricks that make
testing practical. Written for the next developer or agent picking this up. Last updated **2026-11-04**.

- [What to set up](#what-to-set-up)
- [Three ways to run the agents](#three-ways-to-run-the-agents)
- [Models and providers](#models-and-providers)
- [Test plan and status](#test-plan-and-status)
- [Testing techniques](#testing-techniques)
- [Gotchas](#gotchas)

---

## What to set up

1. `npm run dev` (port 3000) **and** `npm run inngest:dev` in a second terminal. Without the Inngest Dev Server,
   Run fails with "Is the Inngest Dev Server running?" and the run is marked failed.
2. Sign in, create a workspace linked to a **throwaway repository**. Agents create real branches, commits, pull
   requests, issue comments and (with **File issues**) issues on it, even in simulated mode.
3. GitHub connected for the workspace owner (Settings shows the account). A `401 Bad credentials` from GitHub means
   the stored token is revoked: reconnect.
4. Pick how agents run (next section). Restart `npm run dev` after editing `.env`.

## Three ways to run the agents

| Mode | How | Costs | Use it for |
| --- | --- | --- | --- |
| **Simulated** | `AGENTS_SIMULATED=true` in `.env` (overrides every model and key) | Nothing | The pipeline itself: columns, branch, commit, PR, review/test recording, merge, rerun. |
| **Real, workspace key** | Settings → AI providers: save an OpenAI and/or Anthropic key, choose the company | Provider API usage, charged to each agent's monthly budget | Real agent behavior and prompt tuning. |
| **Real, server key** | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env` | Same | Fallback when a workspace saved no key. |

**Simulated agents** (`lib/agent-simulated.ts`): each stage takes two turns, one real tool call then a fixed passing
result. Analyst: `list_files`, then ready. Developer: writes `agent-simulations/<branch>.md` on the branch. Reviewer:
`get_diff`, then approve. Tester: `get_checks` (or `get_diff`), then pass. Each turn waits 4 s, so you can watch the
card move (the board polls every 10 s during a run). It **always takes the happy path**: it never asks for info,
requests changes or fails tests.

A Claude.ai / Pro subscription **can't** power the app: Anthropic only allows API keys from the Console for
products (see code.claude.com/docs/en/legal-and-compliance). Use simulated mode to test for free.

## Models and providers

A workspace works with **one company at a time** (Settings → AI providers, `workspaces.ai_provider`). Each agent picks
a model from that company on the AI Team page and remembers one per company (`agents.provider_models`), so switching
back restores earlier choices.

| Model | Provider | $ / 1M in · out | Notes |
| --- | --- | --- | --- |
| GPT-6 Astra | OpenAI | 10 · 50 | Flagship |
| GPT-6.1 Sol | OpenAI | 2 · 10 | Default for Analyst, Developer, Reviewer; also drafting/trust reviews on OpenAI |
| GPT-6.1 Terra | OpenAI | 1 · 5 | Maps to Sonnet on a switch (no Claude equivalent) |
| GPT-6 Luna | OpenAI | 0.1 · 0.5 | Default for Tester |
| Claude Opus 5.5 | Anthropic | 4 · 20 | Refusal fallback on |
| Claude Sonnet 5.5 | Anthropic | 2 · 10 | Default for Analyst, Developer, Reviewer; also drafting/trust reviews on Anthropic; refusal fallback on |
| Claude Haiku 5.5 | Anthropic | 0.1 · 0.5 (0.5 · 2.5 above 100K-token prompts) | Default for Tester |

Prices live in `AGENT_MODELS` (`lib/agent-config.ts`); update them there. Equivalents for a first switch:
`EQUIVALENT_MODEL`.

How each provider runs a stage (`lib/agent-loop.ts`):

- **OpenAI** — Responses API; conversation kept by OpenAI (`previous_response_id`); last turn forces the finish tool.
- **Anthropic** — Messages API, streamed; conversation stored in `agent_run_messages` (append-only, written at fixed
  positions so a retried Inngest step overwrites itself; thinking blocks are sent back unchanged). Prompt caching on
  (`cache_control`), `effort: "medium"`, tool schemas converted for strict mode (`toClaudeSchema`). Claude 5.5 models
  reject forced tool choice, so the last turn adds a "call the finish tool now" system message instead. Opus and
  Sonnet send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): if a safety classifier declines, Anthropic
  retries on its recommended model and the cost is priced at the model that answered. A refusal or context overflow
  stops the run with a clear reason.
- The model is **pinned per stage**: changing it mid-run applies from the next stage.

## Test plan and status

✅ verified · 🟡 partly verified · ⬜ not tested yet.

| # | Scenario | How | Expected | Status |
| --- | --- | --- | --- | --- |
| 1 | Simulated happy path, manual merge | Simulated mode, merge Manual, ▶ Run | Analysis → In Development → In Review → Testing, "PR #n ready to merge"; branch + note file + PR on GitHub | ✅ by the user in the browser |
| 2 | Merge from the card | Green Merge button (replaces ▶) or ⋯ → Merge PR #n | Card to Done, "Merged PR #n", ▶ becomes a static check | ✅ by the user |
| 3 | Rerun a card with an open PR | ⋯ → "Run again on PR #n" | Same branch and PR, verdicts reset, old run "Replaced…", Developer told to build on it | 🟡 DB logic by script; not run in the browser |
| 4 | PR closed on GitHub | Close the agent PR on GitHub, wait for a board sync or Refresh | Card shows "Agents stopped: The pull request was closed on GitHub without merging"; a rerun starts a fresh branch | 🟡 code path shared with the Pull Requests page; not run end to end |
| 5 | Stop | ⋯ → Stop agents during a run | Run cancelled, card unassigned (back to Todo if in Analysis) | ✅ (earlier session) |
| 6 | Auto pickup | Settings → Task pickup Automatic, a never-run Todo card | Within 2 min the Analyst takes it; one card at a time per workspace | 🟡 SQL verified; not run end to end |
| 7 | Auto merge | Settings → Merging Automatic | After tests pass, merges when GitHub says mergeable and CI is green; waits up to 10 min | ⬜ |
| 8 | Merge blocked | A PR with a conflict or failing CI, then Merge | Tester files a follow-up bug card in Todo (+ GitHub issue with **File issues**); reason shown above the board | ⬜ |
| 9 | Real OpenAI run | Workspace key or `.env`, simulated off | Agents use tools, produce a real change and PR; costs appear on AI Team | ⬜ |
| 10 | Real Anthropic run | Same with an Anthropic key | Same; `agent_run_messages` fills up; cost from cache-aware usage | 🟡 against a local fake of the API (request shape, history, retries, cost); never against the real API |
| 11 | Needs info, rework rounds | Real models only (simulated never triggers them) | Vague card → question on the issue, card to Todo; reviewer/tester fail → back to Developer, max 2 rounds | ⬜ |
| 12 | Pause / budget mid-run | Pause an agent or lower its budget while it works | Run stops at the next turn with the reason | ⬜ |
| 13 | Missing key | Agent on a company without a key, ▶ Run | Refused up front: "Developer: Claude Sonnet 5.5 needs an Anthropic API key…" | ✅ by script |
| 14 | Save / replace / remove a key | Settings → AI providers | Invalid key rejected by the provider inline; valid key saved masked (`sk-ant-••••abcd`); Remove asks first | 🟡 invalid key (real OpenAI and Anthropic APIs) and remove ✅; saving a **valid** key not tried |
| 15 | Switch company | Settings → AI providers → Switch provider | All agents move to their model for that company; switching back restores earlier picks; logged per agent | ✅ by script and browser |
| 16 | Model per agent | AI Team → Configure | Picker lists only the workspace's company; server rejects the other company's models | ✅ (UI + script) |
| 17 | Draft with AI / AI trust scan | AI Team → Configure, with a key | Uses the workspace's company (or the other if only it has a key) | ⬜ with a real key |
| 18 | Live office follows a run | AI Team page open, ▶ Run a card (simulated is enough) | Each agent types at its desk during its stage, bubble shows "Analyzing KEY •••" etc., others still; header "Live · 1 working"; no reload needed | ✅ by the user (2026-11-04) |
| 19 | Overview and Activity on real data | Overview / Activity with and without cards and runs | Real counts, upcoming cards, AI team status, timeline with cost per step; empty states when there's nothing | ✅ in the browser with test users (2026-11-04) |
| 20 | Out of credit → switch and retry | A run stopped with `failure: out_of_credit` (seeded), a key for the other company, then **Switch to … and retry** | Notice above the board, card "Out of OpenAI credit"; the button moves the team (models per company) and starts a new run | ✅ in the browser with a seeded run (2026-11-04); the provider actually running dry not tried |
| 21 | Automatic switch | Settings → Switch automatically on, both keys, then a provider out of credit mid-run | Team switches, stage restarts on the other company, "Switched the team to …" notification | 🟡 toggle saves ✅; detection unit-tested; never run end to end (needs a provider failing with no credit: a fake API server or an empty account) |
| 22 | Agent log | ⋯ → View agent log, or a notification link (`/board?log=<card>`) | Stages with agent, model, turns, cost, result or stop reason, files changed, tool calls (failures in red); follows a running card | ✅ in the browser (seeded steps + a real stop) |
| 23 | Notifications | Trigger PR ready / needs info / stop / out of credit | Bell count, list newest first, opening marks read, Mark all as read | ✅ in the browser; `run_failed` produced by a real run stop |

Suggested order for the next session: 9 or 10 on a small, well-described card (e.g. "Add a README section"), then 3,
4 and 8, then 6/7, then 11 with a deliberately vague card.

## Testing techniques

- **Unit tests**: `npm test` (Vitest, `vitest.config.mts`). Tests sit next to their module as `*.test.ts`;
  `server-only` is aliased to `test/server-only.ts`, so `lib/` modules import fine (no database is touched).

- **Test users**: sign up through the app (`/sign-up`) with an `e2e-…@example.com` address, then add a workspace row
  directly in SQL (no GitHub needed to view pages): `insert into workspaces (owner_id, name, icon, github_repo_id,
  github_repo_full_name, github_repo_url, github_default_branch, github_repo_private) values (…)`.
- **Cleanup**: delete the hosted auth user with the admin API (`GET {AUTH_URL}/admin/users?search=…`, then
  `DELETE {AUTH_URL}/admin/users/<id>`, header `x-api-key: <AUTH_SECRET_KEY>`), then the local `users` row (workspaces,
  agents, runs, keys cascade). **Close the browser first** (see Gotchas).
- **Scripts against `lib/`**: run with `npx tsx --tsconfig tsconfig.json <file>` from a temporary folder **inside the
  project** (ESM resolves `drizzle-orm` etc. from the script's location). Modules start with `import "server-only"`,
  which isn't installed: point `NODE_PATH` at a folder containing `server-only/index.js` (empty) and
  `server-only/package.json` (`{"name":"server-only","main":"index.js"}`). Load `.env` yourself at the top of the script
  before importing `@/db`.
- **Claude without a key**: start a small HTTP server that answers `POST /v1/messages` with SSE events
  (`message_start`, `content_block_*`, `message_delta`, `message_stop`) and set `ANTHROPIC_BASE_URL` to it; log the
  request bodies to check what the app sends.
- **Browser**: Playwright works well; `sr-only` radio inputs (settings option cards) must be clicked through their
  `<label>`. Navigating to the same URL with only a different `#hash` doesn't reload; use `location.reload()`.

## Gotchas

- **Deleted local users come back** if a browser still holds their session cookie: the app recreates the `users`
  row on the next request. Close the test browser before deleting users.
- `.env` changes need a dev server restart; `AGENTS_SIMULATED=true` hides every provider problem (no key checks).
- Agent branches are never deleted by the app. Reruns after a closed PR get a `-r<runId>` suffix when the old branch
  still exists.
- Verify with `npm run check` (types, ESLint, Vitest) and `npm run build`. Unit tests cover pure logic only.
- Playwright's screenshots inject `caret-color: transparent` into focused inputs, which shows up as a hydration
  warning in the dev overlay ("1 Issue"). It's the test tool, not the app.
