# Background jobs (Inngest)

Long-running and retryable work runs as [Inngest](https://www.inngest.com) functions, outside the request that
triggered it. SwitchAgent scans are the exception: they run on **Cloudhike Jobs** (HTTP jobs that call the app back),
see [switch-trust.md](switch-trust.md#background-jobs-cloudhike). Code: [`lib/inngest/`](../lib/inngest), served by [`app/api/inngest/route.ts`](../app/api/inngest/route.ts).

- [How it fits together](#how-it-fits-together)
- [Registered functions](#registered-functions)
- [agent-task-run](#agent-task-run)
- [agent-auto-pickup](#agent-auto-pickup)
- [Local development](#local-development)
- [Production](#production)
- [Adding a function](#adding-a-function)

---

## How it fits together

```mermaid
sequenceDiagram
    participant B as Board (browser)
    participant A as runCardAction (server)
    participant I as Inngest (Dev Server or Cloud)
    participant F as /api/inngest
    participant DB as Postgres
    participant GH as GitHub / model provider

    B->>A: Run card 42
    A->>DB: agent_runs (status queued)
    A->>I: inngest.send("agent/task.run", {workspaceId, taskId, runId})
    alt send fails
        A->>DB: run failed ("couldn't be queued")
        A-->>B: error
    end
    A->>DB: card → Analysis, assigned to the analyst
    A-->>B: updated card ("Queued for the agents")
    I->>F: invoke agent-task-run
    loop each stage, one step per model turn
        F->>GH: Model turn + tool calls (GitHub API)
        F->>DB: card column/assignee, run phase, spend
    end
    par review phase
        F->>GH: Reviewer turns (review-<round>-turn-n)
    and
        F->>GH: Security turns (security-<round>-turn-n)
    end
    F->>DB: Lead's decision + final risk, then testing, then merge or wait
    B->>A: polls every 10 s while a run is active
```

- The client is created in [`lib/inngest/client.ts`](../lib/inngest/client.ts) (`id: "fastnext-app"`).
- `/api/inngest` exposes the functions with `serve()` (GET = introspection, PUT = registration, POST = execution).
- Inngest calls back into the app over HTTP, so the app must be reachable from wherever Inngest runs.

## Registered functions

| Function id | Trigger | Source | What it does |
| --- | --- | --- | --- |
| `agent-task-run` | event `agent/task.run` | `lib/inngest/agent-run.ts` | The agent pipeline for one card (below). |
| `agent-auto-pickup` | cron `*/2 * * * *` | `lib/inngest/agent-pickup.ts` | Auto pickup: starts a run on the top never-run Todo card per workspace. |
| `switch-weekly-scans` | cron `0 6 * * 1` (Mondays 06:00 UTC) | `lib/inngest/switch-weekly.ts` | Queues a SwitchAgent scan of every agent in each Switch-connected workspace with **Scan every week** on (the scans themselves run on Cloudhike jobs). |

The starter template's example jobs and its unauthenticated `POST /api/inngest/trigger` route were removed.

## agent-task-run

Queued by **Run** (`runCardAction`) and by auto pickup, always after the `agent_runs` row exists. Event data:
`{ workspaceId, taskId, runId }` (`AgentTaskRunData`). Stage logic lives in
[`lib/agent-pipeline.ts`](../lib/agent-pipeline.ts); every step reloads what it needs from the database.

```
                                         ┌─ review (Reviewer) ──┐
analysis ──ready──▶ development ──▶ PR ──┤                      ├──▶ approval (Lead) ──approve──▶ testing ──pass──▶ merge
   │                    ▲                └─ security ───────────┘          │                         │        (or wait:
   └─needs_info─▶ Todo  │                                                  │                         │      mode × risk)
                        └──────────── request_changes / fail (≤ 2 rework rounds) ────────────────────┘
```

- **Concurrency**: one run per card (`key: "event.data.taskId"`). Runs of different cards run in parallel.
- **Retries**: 2 per step. A revoked GitHub token or missing connection throws `NonRetriableError`.
- **Cancel**: Stop sends `agent/task.cancel` (`cancelOn` matches `data.runId`); the run is already marked `cancelled`.
- **onFailure**: marks the run `failed` with the error message (`stopRun`: also closes the stage in the agent log and
  notifies the owner).
- **Stages** (`runStage` in `agent-run.ts`): one per agent (`AGENT_STAGES`: analysis, development, review, security,
  approval, testing). Review and security run in **parallel** (`Promise.all` of two `runStage` calls): Inngest runs
  their steps side by side, each still one step per model turn, with ids prefixed by the stage so they never collide.
  1. `<stage>-<round>-start` → `beginStage`: agent enabled + under budget (`checkAgentCanRun`), required permissions
     present (Developer: `code.write`, `pr.open`), run marked running in the stage's phase only if it's still active
     (`markStageRunning`), card moved to the phase's column and assigned (the phase's first agent only), a `task_run`
     activity row opened.
  2. `<stage>-<round>-turn-<n>` → `runStageTurn`: one model call (`lib/agent-loop.ts`) plus its tool calls
     (`lib/agent-tools.ts`). Re-checks pause/budget each turn; adds the turn's cost to the activity row and the run.
     The model is pinned on the stage's first turn. **OpenAI**: the conversation lives on OpenAI
     (`previous_response_id`); steps only carry pending tool outputs. **Anthropic** and **OpenRouter** (Chat
     Completions): the conversation is stored in `agent_run_messages` and steps only carry its length, so step output
     stays small. Three turns before the agent's **max turns** a wrap-up note follows the tool results; the last turn
     forces the finish tool (OpenAI), offers only it (OpenRouter) or adds a "finish now" system message (Claude 5.5
     models reject forced tools), and asks the Developer to submit unfinished work with what's left. A stage that still
     ends without a result goes to `<stage>-<round>-out-of-turns` → `settleOutOfTurns` (the Developer's commits and
     missing reviews continue as unfinished results; otherwise the run stops). Each turn's tool calls go
     to `agent_run_steps` (the card's agent log), and the stage's end too. If the run stopped meanwhile (the parallel
     stage failed), the turn stops too and only this stage's log is closed.
  3. **Out of credit** (OpenAI `insufficient_quota` / billing codes, Anthropic "credit balance too low", OpenRouter
     402 except its in-flight budget): with `workspaces.ai_auto_failover` on and a key for another company, the turn
     moves every agent on the broke company to the first other company with a key (`fallbackProvider`,
     `moveAgentsToProvider`) and returns `restart`: the stage starts over on the new provider,
     **once per stage**.
     Otherwise the run stops with `failure: { kind: "out_of_credit", provider }`, which the board turns into a
     "switch and retry" notice.
- **Sandbox** ([sandbox.md](sandbox.md)): with Settings → Sandbox on, a Developer or Tester turn may call
  `run_tests` / `run_build` / `run_command`, which run inside the turn's step (up to 5 minutes each, one at a time per
  run). The run's volume is removed when the run ends (`finishRun`), whatever the outcome.
- **Between stages**: `branch-<round>` (creates `agent/<key>-<slug>` from the default branch, once per run),
  `pull-request-<round>` (opens the PR, fails if nothing was committed), the **CI gate** — `ci-<round>-start` (records
  "waiting" on the branch head; knows whether the repo has workflows in `.github/workflows/`), then
  `ci-<round>-wait-<n>` sleeps and `ci-<round>-poll-<n>` checks (10 s, then every 30 s, at most 30 polls) until every
  check finished (`classifyCi`); a failure caused by the change → `rework-after-ci-<round>`, or `ci-exhausted` after
  the last round — then `record-review-<round>` and
  `record-security-<round>` (after both parallel stages), `record-approval-<round>` (the Lead's decision raised to the
  risk floor; sets the PR's review status and risk), `record-test-<round>` (deterministic pre-checks always fail the
  verdict when they fail), `ready-to-merge` (merge mode × final risk, `mergeDecision`), then `merge-<n>` attempts
  30 s apart (automatic merges only; up to 10 minutes, then the run waits for a manual merge).
- **Merge** ([`lib/pull-requests.ts`](../lib/pull-requests.ts)): merges (squash) only when GitHub reports the PR mergeable
  and every check run / commit status passed. A conflict or failing build makes the Tester file a follow-up card in Todo
  (and a GitHub issue with the **File issues** permission); the run ends `failed` with the reason. Running the
  follow-up card continues on the same PR: the Developer merges the default branch in (`merge_default_branch`,
  [features.md](features.md#merging-the-default-branch)) and the pipeline reviews and tests it again; the merge moves
  both cards to Done.
- **Notifications** (`notify`, lib/notifications.ts; never throws, so it can't fail a step): PR ready to merge
  (manual merge, not low risk in "Automatic when low risk" — with the risk and its reasons — or auto merge timed out), merged (auto merge), merge blocked, analyst needs info, run stopped, out of
  credit, provider switched.

## agent-auto-pickup

Every 2 minutes: for each workspace with **Settings → Agents → Task pickup: Automatic** and no `queued`/`running`
run, creates a run for the top Todo card that **was never run** and sends `agent/task.run`. Skipped entirely without
a provider (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `AGENTS_SIMULATED=true`), and per workspace while the Analyst is paused or over budget, or an agent's model has no provider key. Cards that were run before (failed,
needs info) wait for a human to press Run (or Answer, for a question). A never-run follow-up card the Tester filed
for a blocked merge is picked up like any other and continues on that pull request (`createCardRun`).

## Local development

```bash
npm run dev            # app on :3000 + Inngest Dev Server, one terminal (concurrently)
npm run inngest:dev    # only the Dev Server: npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

- Dev Server UI: <http://localhost:8288> — see events, runs, step output and logs; replay runs.
- No keys are needed locally. The SDK (v3) infers **Dev Mode** outside production and sends events to the Dev
  Server.
- **If the Dev Server isn't running**, the SDK falls back to Inngest Cloud with the placeholder `INNGEST_EVENT_KEY`
  and gets `401 Event key not found`. Run then fails with "Is the Inngest Dev Server running? Start the app with
  `npm run dev` (it starts Inngest too)." — the run is marked failed and nothing is assigned.
- Force a mode with `INNGEST_DEV=1` (dev) or `INNGEST_DEV=0` (cloud).

## Production

1. Create an app in the Inngest dashboard and copy the **Event key** and **Signing key** into `INNGEST_EVENT_KEY`
   and `INNGEST_SIGNING_KEY`.
2. Deploy. In Cloud Mode `/api/inngest` verifies request signatures with the signing key.
3. Sync the app in the Inngest dashboard with `https://<your-domain>/api/inngest` (or use the Vercel integration).

## Adding a function

1. Create it in `lib/inngest/<name>.ts` with `inngest.createFunction({ id, name, retries, concurrency? }, { event }, handler)`.
   Export the event name and its data type next to it (see `AGENT_TASK_RUN` / `AgentTaskRunData`).
2. Add it to the `functions` array in `app/api/inngest/route.ts`.
3. Send events only from server code, after authorizing the user, with `inngest.send({ name, data })`.
4. Re-check ownership/existence inside the function: data can be stale by the time it runs.
5. Restart `npm run dev` (or `npm run inngest:dev` alone) if the Dev Server doesn't pick up the new function.
