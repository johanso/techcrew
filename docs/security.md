# Security

How the app protects accounts, data and secrets, and what isn't covered yet.

- [Sessions](#sessions)
- [Authorization](#authorization)
- [Input validation](#input-validation)
- [Secrets](#secrets)
- [GitHub tokens](#github-tokens)
- [File uploads](#file-uploads)
- [Redirects and CSRF](#redirects-and-csrf)
- [Known gaps](#known-gaps)
- [Checklist for new code](#checklist-for-new-code)

---

## Sessions

- The session token from the auth service lives in the `session_token` cookie: **HTTP-only** (no JavaScript access),
  `SameSite=Lax`, `Secure` in production, expiring with the session.
- Every request that needs a user validates the token with the auth service (`GET /get-session`), cached once per
  request. A missing or invalid token is treated as signed out.
- Social sign-in returns the token in the URL **fragment** (`#token=…`), which browsers never send to servers. The
  callback page removes it from the address bar immediately and exchanges it through a server action.
- Sign-out revokes the session on the auth service and deletes the cookie.

## Authorization

- `proxy.ts` is an **optimistic** guard only (cookie presence) for `/dashboard/*` and `/workspaces/*`. Real checks
  happen in every page, action and route handler.
- Workspaces have a single owner. Every workspace id from the URL or a request body is loaded with an owner-scoped
  query (`getOwnedWorkspace`, `getDashboardContext`); others get a 404.
- Board actions authorize first, then scope every query to the workspace (`onBoard()`), and reject moves that
  include a card from another workspace.
- The logo route streams an object from S3 only to the owner of the workspace that references it; object keys are
  never accepted from the client.
- Background jobs re-check that the card still exists in the workspace before acting.

## Input validation

- All Server Action input is treated as untrusted and validated on the server, even when the client already validated
  it: `parseCardInput` / `parseBoardInput` (`lib/board.ts`), `createWorkspace` (`app/workspaces/actions.ts`), the
  auth actions.
- Allowed values (types, priorities, columns, icons) are checked against allowlists; lengths are capped (title 120,
  description 5000, labels 5 × 30, workspace name 60); dates must be valid `yyyy-MM-dd`.
- Repository names are checked against `^[\w.-]+\/[\w.-]+$` before being used in a GitHub API path, and the repo is
  re-read from GitHub instead of trusting client-supplied metadata.
- Drizzle parameterizes every query.

## Secrets

- Real values go only in `.env` (gitignored). `.env.example` holds placeholders.
- Server-only modules (`import "server-only"`) can't be bundled into client code by mistake.
- `AUTH_SECRET_KEY`, `GITHUB_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `S3_*` and `INNGEST_*` are never exposed to the
  browser; only `NEXT_PUBLIC_APP_URL` is public by design.
- ⚠️ An early version of `.env.example` (before the first commit) contained real-looking AWS keys. They were moved to
  `.env` and never committed, but **rotate that AWS access key** if it was ever shared.

## GitHub tokens

- Encrypted at rest with AES-256-GCM, a random IV each time, and an auth tag that detects tampering (`lib/crypto.ts`).
- Decrypted only server-side, only when calling GitHub, and never logged or returned to the client.
- Requested scopes are the minimum for the product: `repo` (agents will push) and `read:user`.
- The OAuth flow uses `state` (CSRF) and PKCE (`S256`).

## AI provider keys

- Saved per workspace in Settings → AI providers, in their own table (`ai_provider_keys`) so a workspace row never
  carries a secret. Encrypted like GitHub tokens (`lib/crypto.ts`, `TOKEN_ENCRYPTION_KEY`).
- Checked with the provider before saving (a free model listing), so a wrong key fails at once.
- Never sent back to the browser: Settings shows only a masked hint (`sk-ant-••••a1B2`). The eye button shows what you
  are typing, not the saved key. A successful save clears the field.
- Decrypted only server-side, per call (`getAIKeys`), and passed to the SDK client for that call.
- Without a workspace key, the server's `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is used, if set.

## Agents

The pipeline acts on the repository with the workspace owner's token, so its guardrails live in code, not prompts:

- **Tools follow skills** (`toolsFor` in `lib/agent-tools.ts`): no *Write code* → no write tools; writes only target
  the run's own `agent/…` branch, never the default branch. Tool calls outside the agent's set are refused even if
  the model invents them.
- **Protected paths**: agents can't write `.github/workflows/*` (a workflow could exfiltrate repository secrets),
  `.env*` files (except `.env.example`) or `.git/`. Dependency manifests and lockfiles need *Manage dependencies*.
  Paths with `..`, empty segments or a leading `/` are rejected.
- **Prompt injection**: issue text, code, comments and CI output reach the model inside `<task>` or as tool output; the
  system prompt's operating protocol (which overrides the configurable instructions) treats them as data.
- **Merging** is never an agent tool: it happens only through `mergeAgentPullRequest` (manual button or the workspace's
  auto-merge setting), and only when GitHub reports the PR mergeable with every check green.
- **Spend** is bounded per stage by max turns and per month by each agent's budget, both re-checked every turn.

## File uploads

- Workspace logos: PNG, JPEG, WebP or GIF only, ≤ 1 MB, checked on the client and again on the server.
- **SVG is rejected** on purpose: it can carry scripts and would be served from the app's own origin.
- Stored in a private bucket under a random UUID key; served with `X-Content-Type-Options: nosniff` and
  `Cache-Control: private`.
- Server Action body limit is raised to 1.5 MB (`next.config.ts`) to fit a 1 MB file plus multipart overhead.

## Redirects and CSRF

- Post-auth destinations (`next`) must be same-origin relative paths (`isSafeRedirectPath`: starts with `/`, not `//`
  or `/\`), which prevents open redirects.
- Server Actions are protected by Next.js's Origin check (same-origin only by default).
- The OAuth `state` and the short-lived, path-scoped `github_oauth` / `auth_next` cookies protect the redirect flows.

## Known gaps

| Gap | Risk | Suggested fix |
| --- | --- | --- |
| Agents can be steered by a malicious issue within their tools (e.g. a harmful code change on their branch). | A bad PR. Nothing merges without review + tests, and auto-merge is off by default. | Keep auto-merge off for repos that accept issues from outsiders; review agent PRs. |
| The agent log stores tool targets and the first line of tool answers (paths, error messages). | Repository paths and error text are kept in Postgres. File contents never are (reads store no summary). | Nothing needed; keep `toolStep` from summarizing read tools. |
| No rate limiting on Server Actions or route handlers. | Brute-force or abuse of create/sync endpoints. | Add per-user limits (e.g. Upstash Ratelimit) on sync, create and run. |
| Workspaces have no members or roles. | Not a risk today, but anything shared later needs an access model. | Add memberships before any sharing feature. |
| Disconnecting GitHub doesn't revoke the token on GitHub. | The (encrypted, deleted) token stays valid on GitHub's side until the user revokes it. | Call GitHub's "delete an app token" endpoint on disconnect. |
| Content Security Policy is not configured. | Defense-in-depth only. | Add CSP headers in `next.config.ts` or `proxy.ts`. |
| The repository a workspace links to is fixed at creation. | If access is lost, the board can't sync (it says so). | Add a "change repository" setting with the same re-check as creation. |

## Checklist for new code

- [ ] Pages/actions call `requireUser()`; route handlers call `getCurrentUser()`.
- [ ] Every id from the request is loaded with an owner-scoped query.
- [ ] Server-side validation for every field, with allowlists and length caps.
- [ ] New secrets go in `.env` and `.env.example` (placeholder), and are read only in `server-only` modules.
- [ ] No tokens, keys or object keys in responses, logs or client props.
- [ ] Redirect targets go through `isSafeRedirectPath`.
