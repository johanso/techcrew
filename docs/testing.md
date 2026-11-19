# Testing the agents

How to exercise the AI agent features end to end, what has been verified and what hasn't, and the tricks that make
testing practical. Written for the next developer or agent picking this up. Last updated **2026-11-05**.

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
| **Real, account key** | Settings → Your account → AI keys: save an OpenAI and/or Anthropic key once (every project uses it); choose the company per workspace in AI provider | Provider API usage, charged to each agent's monthly budget | Real agent behavior and prompt tuning. |
| **Real, server key** | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env` | Same | Fallback when a workspace saved no key. |

**Simulated agents** (`lib/agent-simulated.ts`): each stage takes two turns, one real tool call then a fixed passing
result. Analyst: `list_files`, then ready. Developer: writes `agent-simulations/<branch>.md` on the branch. Reviewer:
`get_diff`, then approve. Tester: `get_checks` (or `get_diff`), then pass. Each turn waits 4 s, so you can watch the
card move (the board polls every 10 s during a run). It **always takes the happy path**: it never asks for info,
requests changes or fails tests.

A Claude.ai / Pro subscription **can't** power the app: Anthropic only allows API keys from the Console for
products (see code.claude.com/docs/en/legal-and-compliance). Use simulated mode to test for free.

## Models and providers

Each agent picks its **company and model** on the AI Team page (Configure → Company, Model); a team can mix
companies. `agents.provider_models` remembers each agent's model per company for out-of-credit moves.

| Model | Provider | $ / 1M in · out | Notes |
| --- | --- | --- | --- |
| GPT-6 Astra | OpenAI | 10 · 50 | Flagship |
| GPT-6.1 Sol | OpenAI | 2 · 10 | Default for Analyst, Developer, Reviewer, Security and Lead; also drafting/trust reviews on OpenAI |
| GPT-6.1 Terra | OpenAI | 1 · 5 | Maps to Sonnet on a switch (no Claude equivalent) |
| GPT-6 Luna | OpenAI | 0.1 · 0.5 | Default for Tester |
| Claude Opus 5.5 | Anthropic | 4 · 20 | Refusal fallback on |
| Claude Sonnet 5.5 | Anthropic | 2 · 10 | Default for Analyst, Developer, Reviewer, Security and Lead; also drafting/trust reviews on Anthropic; refusal fallback on |
| Claude Haiku 5.5 | Anthropic | 0.1 · 0.5 (0.5 · 2.5 above 100K-token prompts) | Default for Tester |
| Gemini 4 Argon | OpenRouter (Google) | 2 · 10 | Flagship |
| Grok 4.7 | OpenRouter (xAI) | 2 · 6 | Flagship |
| DeepSeek V4 Pro | OpenRouter (DeepSeek) | 0.111 · 4.44 | Default for Analyst, Developer, Reviewer, Security and Lead on OpenRouter; also drafting/trust reviews on OpenRouter |
| GLM 5.3 | OpenRouter (Z.ai) | 0.07 · 1.4 | Balanced |
| Kimi K3.1 Pro | OpenRouter (Moonshot) | 0.253 · 8.8 | Balanced |
| Gemini 4 Hydrogen | OpenRouter (Google) | 1.5 · 7.5 | Efficient |
| Grok Build 0.1 | OpenRouter (xAI) | 1 · 2 | Efficient |
| DeepSeek V4.1 Flash | OpenRouter (DeepSeek) | 0.3 · 1.2 | Default for Tester on OpenRouter |
| GLM 5.3 Flash | OpenRouter (Z.ai) | 0.15 · 0.5 | Fast |
| Gemini 3.8 Flash | OpenRouter (Google) | 0.825 · 4.125 | Fast |

Prices live in `AGENT_MODELS` (`lib/agent-config.ts`); update them there. OpenRouter prices are its listed ones: hosts
differ, and the cost logged is the one OpenRouter reports per response. Each model has a **tier** (flagship, balanced,
efficient, fast); moving an agent to another company picks the first model there of the same tier (`closestModel`),
else a neighboring one.

How each provider runs a stage (`lib/agent-loop.ts`):

- **OpenAI** — Responses API; conversation kept by OpenAI (`previous_response_id`); last turn forces the finish tool.
- **Anthropic** — Messages API, streamed; conversation stored in `agent_run_messages` (append-only, written at fixed
  positions so a retried Inngest step overwrites itself; thinking blocks are sent back unchanged). Prompt caching on
  (`cache_control`), `effort: "medium"`, tool schemas converted for strict mode (`toClaudeSchema`). Claude 5.5 models
  reject forced tool choice, so the last turn adds a "call the finish tool now" system message instead. Opus and
  Sonnet send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): if a safety classifier declines, Anthropic
  retries on its recommended model and the cost is priced at the model that answered. A refusal or context overflow
  stops the run with a clear reason.
- **OpenRouter** — Chat Completions through the OpenAI SDK (`baseURL` openrouter.ai); conversation stored in
  `agent_run_messages` like Claude's, with tool calls and `reasoning_details` sent back unchanged. Routing
  (`OPENROUTER_ROUTING`): `data_collection: "deny"` (no host that keeps or trains on prompts), `require_parameters`
  (only hosts that support tools), no 4-bit quantized hosts. Many hosts reject a forced tool, so the last turn adds a
  "call the finish tool now" message; strict schemas aren't enforced everywhere, so the finish call is checked
  (`parseFinishArguments`) and sent back to the model when it's invalid. Cost = `usage.cost` from OpenRouter.
- The model is **pinned per stage**: changing it mid-run applies from the next stage.

## Test plan and status

✅ verified · 🟡 partly verified · ⬜ not tested yet.

| # | Scenario | How | Expected | Status |
| --- | --- | --- | --- | --- |
| 1 | Simulated happy path, manual merge | Simulated mode, merge Manual, ▶ Run | Analysis → In Development → In Review → Testing, "PR #n ready to merge"; branch + note file + PR on GitHub | ✅ by the user in the browser |
| 2 | Merge from the card | Green Merge button (replaces ▶) or ⋯ → Merge PR #n | Card to Done, "Merged PR #n", ▶ becomes a static check | ✅ by the user (again on 2026-11-18: AJU-12, PR #17 on testfixedbutton, a medium-risk PR waiting in *Automatic when low risk*) |
| 3 | Rerun a card with an open PR | ⋯ → "Run again on PR #n" | Same branch and PR, verdicts reset, old run "Replaced…", Developer told to build on it | ✅ by the user (2026-11-05): AJU-4 rerun on PR #8, same branch and PR |
| 4 | PR closed on GitHub | Close the agent PR on GitHub, wait for a board sync or Refresh | Card shows "Agents stopped: The pull request was closed on GitHub without merging"; a rerun starts a fresh branch | ✅ by the user (2026-11-05): PR #9 closed → card stopped; rerun opened PR #10 on `…-r31` |
| 5 | Stop | ⋯ → Stop agents during a run | Run cancelled, card unassigned (back to Todo if in Analysis) | ✅ (earlier session) |
| 6 | Auto pickup | Settings → Task pickup Automatic, a never-run Todo card | Within 2 min the Analyst takes it; one card at a time per workspace | ✅ simulated (2026-11-18, $0): AJU-18 (run 43, `trigger: auto`) taken 45 s after pickup was turned on; AJU-19 (run 44) waited until run 43 ended (one card at a time), then ran to ready to merge. Found and fixed: auto pickup logged no activity; it now logs "Picked up AJU-n" ("… (auto pickup)") as the Analyst's assignment |
| 7 | Auto merge | Settings → Merging Automatic | After tests pass, merges when GitHub says mergeable and CI is green; waits up to 10 min | ⬜ |
| 8 | Merge blocked | A PR with a conflict or failing CI, then Merge | Tester files a follow-up bug card in Todo (+ GitHub issue with **File issues**); reason shown above the board | ✅ simulated with a conflict (2026-11-18, run 40, AJU-14, $0): *Automatic* merge mode; once the run reached review a different version of the Developer's note was pushed to testfixedbutton's `main`. CI had passed, review, approval and tests passed, then the merge step found the conflict: run failed with "Merge blocked. Merge conflict: … Follow-up: AJU-15.", PR #19 `merge_error` set, the Tester filed AJU-15 (bug, high, in Todo, labels bug + merge) and GitHub issue #20, one `merge_blocked` notification. A failing build at merge time takes the same path (the CI gate now usually catches it earlier) |
| 9 | Real OpenAI run | Workspace key or `.env`, simulated off | Agents use tools, produce a real change and PR; costs appear on AI Team | ✅ by the user (2026-11-05) with GPT-6.1 Sol / GPT-6 Luna on a small README card |
| 10 | Real Anthropic run | Same with an Anthropic key | Same; `agent_run_messages` fills up; cost from cache-aware usage | 🟡 against a local fake of the API (request shape, history, retries, cost); never against the real API. The workspace already has a verified Anthropic key: switch provider and Run; Not run live: the workspace's Anthropic account has no credit (2026-11-18, the API answers "Your credit balance is too low"). Needs credit |
| 11 | Needs info, rework rounds | Real models only (simulated never triggers them) | Vague card → question on the issue, card to Todo; reviewer/tester fail → back to Developer, max 2 rounds | 🟡 needs info ✅ with GPT-6.1 Sol (2026-11-05: a card asking for `package.json` commands on a repo without one → question, card to Todo, notification, $0.01); rework rounds 🟡: the loop and its cap work (2026-11-05, PR #8: stopped after 2 rounds), but the reviewer kept asking for a Safari iOS check nobody in the pipeline can run and reviewed from scratch each round. Fixed in the prompts (re-review gets its earlier findings; manual-only checks never block); re-run ✅ by the user: changes requested once, fixed on the same PR, re-review approved, tests passed |
| 24 | Answer the analyst | A card in needs info → **Answer** (card, ⋯ menu or agent log) | Answer saved on the run (posted on the issue when the question is there), card back to Analysis; the new analyst brief uses the answer and doesn't repeat the question; the log shows the question in orange, not as a success | ✅ by the user (2026-11-05): answered AJU-3, the analyst used the answer and the pipeline produced the change |
| 25 | SwitchAgent scan | `PUBLIC_APP_URL` = a tunnel (`ngrok http 3000`), Cloudhike jobs configured, Settings → Switch Trust → Connect securely | Four agents "Scanning…"; registered in Switch with one evaluation each; scores, tests held and OWASP coverage land without reloading; activity "SwitchAgent scan: N/100" with cost | ✅ live with Switch (2026-11-16): 4 agents scored 99 (197–201/201 held, coverage 100 %), ~3 min, $2.09; fixed an early 404 on the run id, per-test activity rows and result paging. Weekly scans and cost caps only against local fakes |
| 26 | People's activity | Move a card to another column, edit its priority, remove a card | Activity: "Moved KEY to …", "Edited KEY" (with the fields), "Removed KEY", as You; moves also on the Overview; reordering within a column logs nothing | 🟡 logging and the feed verified against the database (2026-11-16); not clicked through in the browser |
| 27 | CI | Push to `main` or a `feat/**` branch, or open a PR | GitHub Actions runs `npm run check` and `npm run build` | ✅ green on GitHub (2026-11-16, run 43930409402) after syncing `package-lock.json` (the first two runs failed in `npm ci`) |
| 12 | Pause / budget mid-run | Pause an agent or lower its budget while it works | Run stops at the next turn with the reason | ✅ simulated (2026-11-18, $0): paused the Developer once its stage had begun (run 41) → "Developer was paused."; dropped its budget to $0 (run 42) → "Developer reached this month's budget."; both stopped at the turn check with one `run_failed` notification, the agent restored afterwards. Both stops landed on the stage's first turn: a stop between later turns uses the same check |
| 13 | Missing key | Agent on a company without a key, ▶ Run | Refused up front: "Developer: Claude Sonnet 5.5 needs an Anthropic API key…" | ✅ by script |
| 14 | Save / replace / remove a key | Settings → AI keys (account) and AI provider → Workspace keys | Invalid key rejected by the provider inline; valid key saved masked (`sk-ant-••••abcd`); Remove asks first | ✅ invalid key rejected and remove ✅; valid OpenAI and Anthropic keys saved by the user (2026-11-05, verified with each provider on save) |
| 15 | Switch company | Settings → AI providers → Switch provider | All agents move to their model for that company; switching back restores earlier picks; logged per agent | ✅ by script and browser. Removed 2026-11-19: each agent now picks its own company (row 16) |
| 16 | Company and model per agent | AI Team → Configure: change Company, then Model; save; Run | Company select (one without a key says *No key*); changing it picks the closest tier; save refuses a company without a key; agents on both companies run in one pipeline | ✅ single-company (UI + script, before 2026-11-19). ✅ Company select (2026-11-19): checked by the user in the browser; `agentModel` / `defaultProvider` unit-tested. 🟡 No mixed-company run yet |
| 17 | Draft with AI / AI trust scan | AI Team → Configure, with a key | Uses OpenAI, else Anthropic | 🟡 Draft with AI ✅ with OpenAI by script (2026-11-18, Tester, 23.7 s, $0.0105, repository-aware; logged as "Drafted instructions with AI", nothing saved). It claimed the Tester "runs tests": the prompt now says what the agent can run (since v0.6 the Developer and the Tester run tests and builds when the sandbox is on; not re-run with a key). AI trust scan with a real key not run |
| 18 | Live process follows a run | AI Team page open, ▶ Run a card (simulated is enough) | "Inactive" before; then the card's block: steps go working → done in order with results, Review shows Reviewer + Security working at once, last actions and turn/cost update, the agent cards show "Working on KEY"; no reload needed | ✅ by the user in the browser (2026-11-16, simulated run #32 on AJU-6): live process, working cards, agent log |
| 19 | Overview and Activity on real data | Overview / Activity with and without cards and runs | Real counts, upcoming cards, AI team status, timeline with cost per step; empty states when there's nothing | ✅ in the browser with test users (2026-11-04) |
| 20 | Out of credit → switch and retry | A run stopped with `failure: out_of_credit` (seeded), a key for the other company, then **Switch to … and retry** | Notice above the board, card "Out of OpenAI credit"; the button moves the team (models per company) and starts a new run | ✅ in the browser with a seeded run (2026-11-04); the provider actually running dry not tried |
| 21 | Automatic switch | Settings → Switch automatically on, both keys, then a provider out of credit mid-run | Team switches, stage restarts on the other company, "Switched the team to …" notification | ✅ (2026-11-18, $0): OpenAI pointed at a local fake answering 429 `insufficient_quota` (`OPENAI_BASE_URL`), auto failover on, both keys. Run 45 (AJU-20): the Analyst's first turn ran dry → team switched to Anthropic ("Switched the team to Anthropic" notification) → stage restarted on Claude, whose real account is also out of credit. That exposed a bounce: the team was switched back to OpenAI ("… carried on") and then stopped. Fixed: after a failover the stage never switches back; run 46 (AJU-21) stops with "Anthropic is out of credit too, right after the switch from OpenAI…", `failure: out_of_credit` and one `out_of_credit` notification. A failover that then finishes on the second provider needs Anthropic credit |
| 22 | Agent log | ⋯ → View agent log, or a notification link (`/board?log=<card>`) | Stages with agent, model, turns, cost, result or stop reason, files changed, tool calls (failures in red); follows a running card | ✅ in the browser (seeded steps + a real stop) |
| 28 | Simulated happy path with the v0.2 pipeline | Simulated mode, ▶ Run | Analysis → Development → Review (Reviewer and Security interleave in Inngest) → Approval (Lead: approve, low risk) → Testing; `agent_runs.security_report` and `approval` saved; PR shows Approval, Tests and Risk: Low; agent log has Code review and Security review blocks | ✅ (2026-11-16, run #32, AJU-6 → PR #11 on testfixedbutton, ~2 min, $0): Security and Reviewer interleaved (diffs at :32 / :38, results at :44 / :50), then the Lead; reports saved, PR approved · low risk · tests passed, "ready to merge" notification; checked in the DB and by the user in the browser |
| 29 | Merge mode × risk | Settings → Merging: Manual / Automatic when low risk / Automatic; simulated run (Lead rates low) | Manual → "PR #n ready to merge"; Automatic when low risk → merges after CI; a medium-risk change (e.g. touching `package.json`) waits with the reason in the notification | ✅ simulated on testfixedbutton (2026-11-18, $0, CI gate passed in each): *Automatic when low risk* + low risk → AJU-11 merged on its own (PR #16, card to Done, "Merged PR #16" notification); *Automatic when low risk* + medium (the note's path has `-auth-`, so the floor adds "Touches authentication or permissions.") → AJU-12 waits in Testing (PR #17) and the notification gives the risk and its reasons; *Automatic* + medium → AJU-13 merged (PR #18). Manual: row 28 |
| 30 | Parallel stop | Pause Security while the review phase runs | Run stops with Security's reason; the Reviewer stops at its next turn; one notification; both log blocks closed | ✅ simulated (2026-11-18, run 36, AJU-10, $0): Security paused as the review phase began → Security's stage stopped with "Security is paused…" (refused at its start, before a turn), the Reviewer stopped at its next turn ("The run stopped: Security is paused…"), one `run_failed` notification, both log blocks closed. A pause in the middle of Security's turns takes the same `stopRun` path, not separately run |
| 31 | Migration 0005 | `npm run db:migrate` on a database with `agent_auto_merge = true` | `agent_merge_mode = 'auto'`; others `manual` (the old column is dropped in 0007) | 🟡 applied to the dev database (2026-11-16): one workspace, manual → manual; the `true` → `auto` path not exercised on data |
| 32 | Six agents in existing workspaces | Open AI Team on a workspace created before v0.2 | Security and Lead appear with faces, trust scans (rules) ≥ 85 and "Joined the team" activity | ✅ on the dev workspace (2026-11-16): both rows created by `ensureDefaultAgents` |
| 33 | Built-in skills in a workspace | Open AI Team or Settings on an existing workspace | `modern-web-guidance` (211 files) and `chrome-extensions` in the library; the first on for Developer, Reviewer and Security; a built-in switched off stays off after `ensureBuiltinSkills` | ✅ against the dev database by script (2026-11-16) |
| 34 | Skill tools | `searchSkill` / `readSkill` for the Developer; a simulated run | Prompt lists the skill with its TechTeam usage note; "light dismiss dialog" finds the dialog guides; reads page at 30 KB; `../` paths and skills the agent doesn't have are refused; the simulated first turn shows *Searched skill* / *Read skill* in the agent log | ✅ tools against the dev database by script (2026-11-16); simulated run 40 (2026-11-18, $0): every one of the six stages logged one *Searched skill* and one *Read skill* |
| 35 | Upload a skill | Settings → Agent skills → a `.zip` with SKILL.md + references | Scan + one AI review (classification proposed), confirm with Type / Loading / Assign to, installed; tester's prompt includes an always-loaded body; activity "Skill switched on" and a rescan; a token for another file is refused; delete rescans | ✅ by script against the dev database with one real OpenAI review (2026-11-16, $0.0014, no findings); the UI rendered with real data but not clicked through (no browser session) |
| 36 | Blocked upload | A SKILL.md with "Ignore all previous instructions" | Blocked before any model call, findings shown, nothing stored | ✅ by script (2026-11-16) |
| 37 | New version of an uploaded skill | Settings → library → New version | Same name required; rescanned; agents using it get "Skill updated" and a rescan | ✅ by script through the same inspect → install path (2026-11-17): `impact-analysis` v2, one AI review ($0.01, no findings), files replaced, still on for the Analyst |
| 39 | Real run with skills | OpenAI, ▶ Run a UI card on testfixedbutton (AJU-7: footer preview with an 80-character limit) | Every agent searches and reads its skills; the result shows them (tokens, `textContent`, accessible status, no test framework added) | ✅ (2026-11-17, run #33 → PR #12, $0.73, one rework round): 43 skill calls across all six agents; the Reviewer caught a real data-loss bug and the Lead sent it back with concrete required changes; checked in a browser at 320 px. Lessons: the Analyst over-scoped the card (now `impact-analysis` v2 keeps criteria to the card), and the Lead on Astra was 38 % of the cost (default now Sol/Sonnet) |
| 40 | CI gate | ▶ Run a card on a repository with CI on pull requests; one run whose change breaks a check | "Waiting for CI on PR #n…"; a failure goes back to the Developer with annotations and the log tail (rework round, cause "CI" on Metrics); a check already red on `main` doesn't block; no CI → moves on | ✅ simulated, on testfixedbutton with a fixture workflow (`.github/workflows/ci.yml`: fails when a note named `*ci-fail*` is on the branch), 2026-11-18, $0: AJU-8 (run 34) CI passed in ~10 s → review → ready to merge (PR #13); AJU-9 (run 35) failed CI → 2 rework rounds → stopped "CI still fails after 2 rework rounds (check)" (PR #14). The Developer's feedback carried the workflow's own annotation (runner `.github` ones filtered) and the failing step's log (job log downloaded through the manual redirect). Metrics: 3 CI rework rounds attributed to CI. The "already red on `main`" and "no CI" paths are unit-tested only |
| 41 | Metrics page | Sidebar → Metrics, 7 / 30 / 90 days | Delivered, first pass, CI pass rate, cost per delivered card, outcomes, rework causes, spend by agent, recent runs; empty state | ✅ by the user in the browser (2026-11-18); loader also checked by script on the dev database (AJU-7's rework attributed to the Lead, spend by agent sums to the total) |
| 42 | Board columns within the screen | A column with more than 5 cards (Done); search; drag a card below a closed column's preview | The board fits the screen and each column scrolls under its header; 5 cards + **Show N more** / **Show less**; a search shows every match; a drop past the preview opens the column | ✅ by the user in the browser (2026-11-18); `previewCards` unit-tested |
| 43 | Sandbox runner | `runRepoCommand` on techteam-sandbox-demo from a script: tests, build, a network call, a failing command, a second call | Passed / Failed with exit code and the end of the output; no network while the command runs; the second call skips the install | ✅ against the VPS (KVM 2, gVisor), 2026-11-18: 4 tests pass, build passes, `fetch` fails with `EAI_AGAIN`, `exit 3` reported as exit 3, "dependencies unchanged" on later calls. Over SSH from the Mac ~10 s a call (one with `npm ci` ~17 s) after enabling SSH connection reuse; a container starts in 0.3 s on the VPS itself |
| 44 | Settings → Sandbox | Open `#sandbox` on a workspace whose repo has `package.json`; switch on, save, **Test the sandbox** | Commands prefilled from `package.json`; saved; the check shows Passed and the end of the output | ✅ by the user in the browser on "Sandbox demo" (2026-11-18): saved `npm ci` / `npm test` / `npm run build` and ran the check (its volume `techteam-check-19` stays until the 12 h sweep) |
| 45 | Sandbox in the pipeline | ▶ Run a card with the sandbox on | The Developer and the Tester call `run_tests` / `run_build`; the agent log shows the command and its outcome line; the run's volume is removed when it ends | ✅ simulated, 2026-11-18, $0: "Sandbox demo" #1 (run 47): development `npm test` ✅ 17.0 s and `npm run build` ✅ 10.7 s, CI passed, testing `npm test` ✅ 12.4 s and `npm run build` ✅ 11.1 s, ready to merge; `techteam-run-47` gone afterwards. ✅ live on OpenAI, 2026-11-19: "Sandbox demo" SAN-2 (run 49, shares that add up to the total): the Developer wrote the change and its tests, then ran `npm test` ✅ 23.7 s and `npm run build` ✅ 6.7 s on its own before submitting; CI passed; Reviewer and Security approved, the Lead approved (low risk); the Tester ran `npm test` ✅ 8.6 s and `npm run build` ✅ 6.9 s; PR #2 ready to merge. 6 min 34 s, $0.171 (Developer $0.068, Reviewer $0.038, Security $0.028, Analyst $0.022, Lead $0.014, Tester $0.002). Everything passed first time, so the fix-after-failure loop is still unseen |
| 46 | Account AI keys | Migration 0010, then Settings on another workspace of the same owner; save / remove an account key; a workspace key while the account has one | Workspace keys moved to the owner's account; every owned workspace resolves them; the workspace form says the account's key is used; Spending this month sums every project | ✅ by script, 2026-11-19: migration moved the two keys of "Ajustes de Test" to user 1 and left no workspace rows; `getAIKeys` resolves OpenAI and Anthropic for workspaces 1 and 19; `keyInUse` unit-tested. ✅ by the user in the browser: masked saved keys, AI Team spend per project, Spending this month across projects, the regrouped Settings and the one-item account menu |
| 47 | OpenRouter key | Settings → AI providers → OpenRouter: an invalid key, then a valid one | Invalid rejected inline (checked with `GET /key`, no spend); valid saved masked (`sk-or-v1-••••…`); AI Team → Configure lists OpenRouter models grouped by maker | ✅ by the user (2026-11-19: key saved in Settings, agents moved to OpenRouter models in Configure) |
| 48 | Real OpenRouter run | Every agent on OpenRouter (e.g. DeepSeek V4 Pro, Tester on DeepSeek V4.1 Flash), ▶ Run a small card | Agents use tools through Chat Completions; `agent_run_messages` fills up; cost = OpenRouter's reported cost; finish calls parse | ✅ (2026-11-19) Every model by script: one strict tool call each, all 10 parsed, total $0.008; hosts in the US (DeepSeek on CoreWeave / InferenceNet, not DeepSeek's own API), Gemini 4 Argon slowest (19.5 s). Live: run 50 (AJU-20, PR #23): Developer on DeepSeek V4 Pro, 4 turns, $0.012; Tester on DeepSeek V4.1 Flash, 5 turns, $0.006; `reasoning_details` stored and sent back |
| 49 | Mixed companies in one run | Developer on OpenAI, Reviewer on Anthropic, Tester on OpenRouter | Each stage on its own company; costs add up on the run | 🟡 OpenAI + OpenRouter ✅ (run 50: Analyst, Reviewer, Security, Lead on OpenAI; Developer and Tester on OpenRouter; $0.091 in all, ready to merge); Anthropic not in the mix (no credit) |
| 50 | OpenRouter out of credit | A key with a $0 limit (OpenRouter → Keys → credit limit), ▶ Run | Run stops with "OpenRouter is out of credit"; board offers **Move agents to … and retry** when another company has a key | ⬜ |
| 51 | PR preview | Settings → Sandbox → Previews on, ▶ Run a card on techteam-sandbox-demo | After CI, the card's ⋯ menu and the Pull Requests row show **View preview**; it opens over HTTPS; the agent log has a `preview` row; merging or closing the PR removes it | ✅ Live run 51 (SAN-3 quick tip buttons, 2026-11-19, $0.185): preview started beside the reviews after CI, running at `https://pr-3-pql80d.preview.lugarescolombia.com` in 1 min 37 s, opened over HTTPS from outside. Also by script on the VPS (cert, no internet, unknown hosts, stop). Not yet seen: stop on merge, the board link clicked in the browser |
| 52 | Tester's browser | Same run, Tester with `tests.run` | The Tester calls `browse_preview`; the agent log shows the path, the first line and a thumbnail that opens the screenshot | ✅ Live run 51: the Tester called `browse_preview` 6 times (desktop and mobile, clicked 20% → "$30.00 each · $120.00 total", typed 17 → buttons unselected), 0 console errors; 6 screenshots saved and read back from S3. Thumbnails not yet opened in the browser UI |
| 53 | Containers can't reach the host | From a container on a preview network: `nc -z <gateway> 22` | Refused; `ssh techteam-vps` and installs still work | ✅ Applied on the VPS (2026-11-19): from a preview network and the default bridge, the host's port 22 (gateway and public IP) is refused; installs still reach npm; `ssh techteam-vps` works; Caddy still serves previews |
| 38 | Skill toggle in the configure dialog | AI Team → Configure → Skills switch | Saves at once; trust rescanned; activity logged; Switch report flagged as older | 🟡 server path ✅ by script; switch not clicked in the browser |
| 23 | Notifications | Trigger PR ready / needs info / stop / out of credit | Bell count, list newest first, opening marks read, Mark all as read | ✅ in the browser; `run_failed` produced by a real run stop |

v0.2 status: rows 18 and 28–32 cover Security, Lead, the risk-based merge and the live process. Unit tests cover
the pure parts (phase/stage mapping, `workingAgents`, `riskFloor`, `mergeDecision`, `liveProcessSteps`).

MVP status (2026-11-16): the core flows are verified live (OpenAI pipeline, answer the analyst, rework, rerun, merge
and close on GitHub, Switch scan). The rows still open (6, 7, 8, 10, 12, 17, 21, 26 in the browser) are deferred to
post-MVP hardening: they spend credit or open PRs, and their code is expected to change. Merging a PR on GitHub moves
its card to Done on the next board sync (✅ by the user, PR #8).

To force a rework round, add a temporary line to the Reviewer's instructions ("TEST MODE: on the first review of every
pull request, request changes with at least one concrete, reasonable improvement.") and remove it afterwards.

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
