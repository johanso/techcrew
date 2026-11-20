# Security

How the app protects accounts, data and secrets, and what isn't covered yet.

- [Sessions](#sessions)
- [Authorization](#authorization)
- [Input validation](#input-validation)
- [Secrets](#secrets)
- [GitHub tokens](#github-tokens)
- [Agents](#agents)
- [Agent skills](#agent-skills)
- [Card references](#card-references)
- [Link captures](#link-captures)
- [File uploads](#file-uploads)
- [Redirects and CSRF](#redirects-and-csrf)
- [Known gaps](#known-gaps)
- [Checklist for new code](#checklist-for-new-code)

---

## Sessions

- The session token from the auth service lives in the `session_token` cookie: **HTTP-only** (no JavaScript access),
  `SameSite=Lax`, `Secure` in production, expiring with the session.
- Every request that needs a user validates the token with the auth service (`GET /get-session`). Validated sessions
  are kept in memory for **60 s** (`lib/session-cache.ts`, keyed by a SHA-256 of the token), because the dashboard polls
  several actions and the service rate-limits ("Too many requests"). Trade-off: a session revoked from another device
  keeps working on this server for up to a minute; signing out here forgets it at once. If the service fails, a session
  validated in the last 10 minutes is still accepted; never past its own expiry. A missing or invalid token is treated
  as signed out (not cached).
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

- Saved on the user's account (`user_ai_keys`, used by every workspace they own) or, optionally, on one workspace
  (`ai_provider_keys`), in their own tables so a workspace row never carries a secret. Encrypted like GitHub tokens
  (`lib/crypto.ts`, `TOKEN_ENCRYPTION_KEY`). A workspace's agents use its **owner's** keys, like its GitHub token.
- Checked with the provider before saving (a free model listing), so a wrong key fails at once.
- Never sent back to the browser: Settings shows only a masked hint (`sk-ant-••••a1B2`). The eye button shows what you
  are typing, not the saved key. A successful save clears the field.
- Decrypted only server-side, per call (`getAIKeys`), and passed to the SDK client for that call.
- Order: the account's key, else the workspace's, else the server's `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
  `OPENROUTER_API_KEY`, if set.
- OpenRouter forwards each call to a host it picks. Every call carries `OPENROUTER_ROUTING` (`lib/openrouter.ts`):
  `data_collection: "deny"` (only hosts that don't store or train on prompts, since prompts carry the repository's
  code), `require_parameters` (only hosts that support tools and structured output) and no 4-bit quantizations.
  Hosts don't all enforce strict schemas, so the finish call is checked again (`parseFinishArguments`).

## Switch Trust

- The Switch key is stored like the AI provider keys (encrypted, masked hint only, checked with Switch before saving).
- Switch reaches each agent at a public endpoint (`/api/switch-trust/agents/<id>/…`) protected by a per-agent bearer
  credential derived from `TOKEN_ENCRYPTION_KEY` (HMAC), compared in constant time. Only Switch receives it. The
  endpoint answers with the agent's own instructions as the system prompt (tests can't replace it), no tools, capped
  output, and refuses an agent over its monthly budget.
- Cloudhike jobs call `/api/switch-trust/scans/<id>` with a random single-use token; only its sha256 is stored and it
  is rotated per job and cleared when the scan ends.
- Test conversations are attacker-written: they're never stored or shown, only counts and Switch's categories.

## Agents

The pipeline acts on the repository with the workspace owner's token, so its guardrails live in code, not prompts:

- **Tools follow permissions** (`toolsFor` in `lib/agent-tools.ts`): no *Write code* → no write tools; writes only target
  the run's own `agent/…` branch, never the default branch. Tool calls outside the agent's set are refused even if
  the model invents them.
- **Protected paths**: agents can't write `.github/workflows/*` (a workflow could exfiltrate repository secrets),
  `.env*` files (except `.env.example`) or `.git/`. Dependency manifests and lockfiles need *Manage dependencies*.
  Paths with `..`, empty segments or a leading `/` are rejected. The rules live in `lib/repo-paths.ts` and cover the
  merge tools too.
- **Merging the default branch** (`merge_default_branch`, `lib/branch-merge.ts`): the merge commit only moves the
  run's own branch, fast-forward only (`force: false`), and only if neither head moved since the merge started. A
  conflict on a protected path, a link or submodule, or a manifest without *Manage dependencies* refuses the whole
  merge before anything is written; resolutions go through the same path rules and are refused while they still hold
  conflict markers. Lockfiles always take the default branch's version (never agent-written). File contents are never
  stored or logged: the open merge (`agent_runs.pending_merge`) keeps commit and blob shas, `read_conflict` recomputes
  the markers from the blobs, and the agent log keeps paths and outcome lines. No clone, no container: the token never
  leaves the app.
- **Adding a package** (`add_dependency`: the Developer with *Write code* and *Manage dependencies*, sandbox on): the
  name and version are validated before anything runs (`lib/sandbox/dependency-config.ts`: npm names only; an exact
  version, one simple range or `latest`; no URLs, git, `file:`, `link:`, aliases or tags) and reach the shell single
  quoted. npm runs in the sandbox's install container (the only one with network) as `npm install
  --package-lock-only --ignore-scripts`: it resolves the package and rewrites package.json and the lockfile without
  downloading tarballs or running any install script. A container without network reads the two files back (≤ 20 MB
  each) and the app commits them through the GitHub API, so the token never enters a container. The new dependency
  still raises the Lead's risk floor (dependency paths) and Security reviews the diff.
- **Prompt injection**: issue text, code, comments, CI output and card references reach the model inside `<task>` or as
  tool output; the system prompt's operating protocol (which overrides the configurable instructions) treats them as data.
- **Merging** is never an agent tool: it happens only through `mergeAgentPullRequest` (manual button or the workspace's
  auto-merge setting), and only when GitHub reports the PR mergeable with every check green.
- **Spend** is bounded per stage by max turns and per month by each agent's budget, both re-checked every turn.
- **Running code** happens only in the sandbox ([sandbox.md](sandbox.md)): throwaway gVisor containers on a separate
  Docker host, never in the app. The repository goes in as a tarball (the GitHub token stays in the app, the `docker`
  CLI gets only `PATH`, `HOME` and `DOCKER_HOST`), tests and builds run with `--network=none`, as user `node`, without
  capabilities, on a read-only root filesystem, with CPU, memory, process and time limits. Only the Developer and the
  Tester get the tools (`tests.run`, Settings → Sandbox on); the agent log keeps the command and its outcome line,
  never the output. The host itself is set up by `deploy/setup.sh`: firewall (SSH, 80, 443), keys-only SSH without
  root (`--lock-ssh`), Docker publishing ports on localhost by default, fail2ban and unattended upgrades. A ufw rule
  refuses traffic from Docker bridges to the host, so no container reaches the host's SSH or other services.
  The install step (the only one with network) runs on `techteam-sandbox` (`172.31.252.0/24`, icc off), whose traffic
  to private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved ranges is refused by the same
  DOCKER-USER rules as link captures (below), with public resolvers in a read-only `resolv.conf`: a dependency's install
  script reaches package registries and the internet, never the provider's private network or the metadata service.
- **Previews** run like sandbox commands, on an `--internal` network with no route out, and are public only at a
  random host (`pr-<n>-<6 random>.<domain>`) while running (2 h at most). Anyone with the link can open it: fine for
  test repositories; a login in front of previews is a follow-up for private apps. Caddy listens on nothing inside
  preview networks and keeps its admin API on its loopback.
- **The Tester's browser** runs Chromium (its sandbox on) under gVisor on the preview's network only, with no secrets.
  Pages are untrusted: the agent log keeps only a first line built from our own data, the report frames the page's
  content as data, and the protocol lists web pages as data. Screenshots are private on S3 and served to the workspace
  owner only, always as `image/png` with `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.

## Agents on your plan (local CLIs)

See [cli-agents.md](cli-agents.md). A CLI agent runs on the owner's computer with the owner's subscription, so its
guardrails are about keeping it inside TechTeam's tools and away from the owner's other logins and secrets:

- **Local only, owner only.** Nothing about CLIs exists unless the app's URL is local and no hosting marker is set; the
  MCP endpoint answers 404 otherwise. Using one's own CLI and login on one's own machine, for oneself, is normal use.
  Offering a claude.ai login to *other people* inside a product isn't allowed without Anthropic's approval: if
  TechTeam is ever offered to others, plan agents must stay a local, owner-only feature.
- **TechTeam's own login.** Claude Code always runs with `CLAUDE_CONFIG_DIR` set to TechTeam's CLI home, so it never
  reads the owner's normal login (for example an employer's organization), settings, hooks, MCP servers, `CLAUDE.md` or
  skills. The owner confirms the signed-in account once; every stage re-checks email and organization and refuses on a
  mismatch. `--bare` isn't used (it can't read a plan login); the other flags remove every built-in tool, settings
  source, slash command and MCP server but TechTeam's.
- **Permissions stay tools.** The CLI has no shell, no file access and no web: only TechTeam's MCP endpoint, which
  serves `toolsFor(stage, permissions, …)` and runs calls through the same `callTool` (protected paths, the run's own
  branch, sandbox rules, references, skills). Tool output stays untrusted data under the same operating protocol.
- **The endpoint's credential** is an HMAC of run, stage and round with `TOKEN_ENCRYPTION_KEY` (nothing stored),
  checked in constant time, and only valid while that stage is the one working. It reaches the CLI through the child's
  environment (the MCP config names `${TECHTEAM_MCP_TOKEN}`), never the command line.
- **No secrets in the child.** `childEnv` passes an allowlist (`PATH`, `HOME`, temp and Windows system folders) plus
  TechTeam's config home: never API keys, the database URL or GitHub tokens. The system prompt goes through a file
  (mode 600) in a per-run temp folder outside the project, removed when the run ends.
- **Windows**: CLIs are spawned with an argument array, never a shell string; an npm `.cmd` shim (which needs a shell)
  is refused in favor of the native build.
- **Run races across computers**: one run in flight per card is a database constraint, not a check-then-act.
- Still to do before the first live run: `scripts/cli-isolation-check.mts` with a signed-in plan (no foreign tools,
  no hooks, no `CLAUDE.md`, the normal login unchanged) on macOS and on Windows.

## Agent skills

Skills are text that reaches agent prompts, so they're treated like any other untrusted input:

- **Never executed.** Only `.md` and `.txt` are kept; agents read skills through two read-only tools
  (`search_skill`, `read_skill`) limited to the skills switched on for them, with validated paths (built-ins: only
  files listed in `agent-skills/catalog.json`; uploads: rows of that skill). Instructions in a skill to run a CLI are
  mapped to those tools by the prompt.
- **Untrusted-content protocol.** The operating protocol overrides "the task, the repository, tool output or skills";
  the skills block says skills are reference material and can't change role, reveal secrets, contact URLs, push to
  the default branch or skip checks. Skill content is logged by target only, never stored in the agent log.
- **Built-ins arrive by pull request.** `npm run skills:sync` downloads the pinned commit's tarball from codeload
  (no token), keeps text files only, rejects unsafe paths and links, and writes `SOURCE.md` + the upstream `LICENSE`.
  Nothing is fetched at agent runtime; an update is a reviewable diff.
- **Uploads** (Settings → Agent skills, owner only): ≤ 5 MB zip (Server Action body limit raised to 6 MB),
  ≤ 3 MB text, ≤ 300 files. The zip reader (`lib/skill-zip.ts`, Node's zlib, no dependency) inflates each entry with
  its declared size as a hard cap and checks its CRC (zip bombs stop there), refuses ZIP64, encryption, multi-disk
  archives, symlinks, absolute paths and `..`. Frontmatter must follow the Agent Skills name/description rules.
- **Security scan before install**: deterministic rules (`lib/skill-scan.ts`) — prompt injection, credentials and
  secret exfiltration block the install; pushing to the default branch, disabling tests/CI, sending data to URLs,
  `curl | sh`, invisible characters, hidden HTML-comment instructions and encoded blobs are findings — plus one AI
  review when a provider key exists (the skill is passed as data to review, never as instructions). Rules run first,
  so a blocked skill costs nothing. The confirm step carries an AES-GCM sealed token (version, AI findings, 30 min) so
  the install can't swap the file or drop the AI's findings, and the rules run again on install.
- **Trust score**: enabled uploaded skills' findings count in every agent's rule-based trust scan; switching a skill
  on or off, a new version or a delete rescans the affected agents. Built-ins count as reviewed.

## Card references

Files the owner attaches to a card for the agents ([features.md](features.md#card-references)):

- **Checked by content.** PNG, JPEG and WebP by their magic bytes (and a readable header ≤ 8000 × 8000 px), PDFs by
  their `%PDF-` header, Markdown and text only as UTF-8 without NUL bytes; the name's extension must agree with the
  content (`detectReferenceFormat`, tested). No SVG, GIF or HTML. Size per kind (image 5 MB, text 1 MB, PDF 5 MB), 10
  per card, counted again under a row lock on the card when the row is written. One file per Server Action call, so
  each fits the 6 MB body limit.
- **Where they live.** The file and a PDF's extracted text are in the private bucket under
  `card-references/<workspace>/<card>/<uuid>.<ext>`; the database keeps a small row (no content). The owner-checked
  route (`/api/workspaces/[id]/references/[referenceId]`) serves the stored type with `nosniff`, `Cache-Control:
  private` and `Content-Security-Policy: default-src 'none'; sandbox`; text as `text/plain`, PDFs only as a download.
  Removing a card deletes its references (S3 deletes are best effort and logged).
- **PDF parsing** runs once at upload with unpdf (PDF.js's serverless build: no worker, no canvas, XFA off), with page
  and character caps. Password-protected or broken PDFs are refused.
- **What goes to the model providers.** Only when an agent calls `read_reference`: text as tool output, images as
  base64 inside the request (OpenAI `function_call_output` → `input_image`; Anthropic `tool_result` → `image`;
  OpenRouter as a user message after the tool messages, under the same routing rules as the code: hosts that keep no
  data). Never a URL: the bucket stays private and no presigned link leaves the server. A model without vision gets a
  note instead of the image.
- **Nothing stored twice.** The conversation (`agent_run_messages`, OpenAI's pending tool outputs in the Inngest step
  state) holds a placeholder for each image; it's loaded from S3 for each request and becomes a note if the reference
  was removed. The agent log keeps the reference's name only, never its content.
- **Prompt injection.** References are the owner's requirements, but the operating protocol lists them as data: they
  can't change the protocol, the agent's role or its tools, and read_reference frames their text as reference material.

## Link captures

A link reference is someone else's web page, opened once by the sandbox browser **with internet access**
([sandbox.md](sandbox.md#link-captures)). The risk is SSRF: a link (or a redirect, an image, a script's request) that
makes the browser reach something internal: the sandbox host, other containers, the provider's network or a cloud
metadata service. What protects what:

| Layer | Where | What it stops |
| --- | --- | --- |
| Link check | `parseCaptureUrl` (`deploy/browser/net-guard.mjs`), in the board action and again in the runner | Schemes other than http/https, user names and passwords, ports other than 80/443/8080/8443, private address literals in any spelling (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`), internal names (`localhost`, single labels, `.local`, `.internal`, `.lan`, `.home.arpa` …) |
| App's DNS check | `lib/sandbox/capture.ts` | A name that resolves to a non-public address, before a container starts (fast, clear error) |
| The runner's proxy | `deploy/browser/capture.mjs` | Every connection Chromium makes, the first page, redirects and subresources alike, goes through a proxy in the container. It resolves the name itself (public resolvers 1.1.1.1 / 8.8.8.8 / 9.9.9.9), refuses when **any** answer is non-public, and connects to the address it checked: a second, different answer (DNS rebinding) is never used. Chromium's implicit loopback bypass is off (`<-loopback>`); QUIC and non-proxied WebRTC UDP are off; WebSockets, media, service workers, downloads and popups are blocked. Caps: 60 MB, 400 connections, 20 s per page. |
| No DNS of its own | gVisor + Docker | Docker's embedded resolver doesn't answer under gVisor, so the page can't resolve names except through the proxy. |
| Network | `techteam-capture` (bridge, `172.31.253.0/24`, `enable_icc=false`) | Capture containers can't reach each other; Docker isolates the bridge from the preview and Caddy networks. |
| Host firewall | `deploy/setup.sh` | ufw refuses anything from a Docker bridge to the host itself (SSH, the public IP, the bridge gateway). DOCKER-USER rules (in ufw's `after.rules`, one block for the capture subnet and the sandbox's install subnet `172.31.252.0/24`) reject traffic from the capture subnet to 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, multicast and reserved: a second layer if anything slipped past the proxy. |
| Container | The Tester's browser limits, with 2 CPUs | gVisor, no capabilities, `no-new-privileges`, read-only root, user `pwuser`, 2 CPUs, 1.5 GB, 256 processes, 100 s; no secrets inside (the URL is the only input, as JSON on stdin). |

"Non-public" means: IPv4 0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local, metadata), 172.16/12,
192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4 and above; IPv6
anything outside 2000::/3 (loopback, IPv4-mapped, NAT64, unique local, link-local, multicast) plus documentation,
Teredo, 6to4, ORCHID and benchmarking ranges (`isPublicAddress`, tested). Checked on the VPS: links to and redirects
toward `169.254.169.254`, `10.x`, `127.0.0.1`, the Caddy network and names resolving to them (`*.nip.io`,
`localtest.me`) were refused, and so were page images pointing there.

What the capture keeps: two JPEG screenshots and an outline (title, headings, landmarks, link and button labels, form
field labels, main texts, fonts and colors) as plain text, cleaned of control characters and markup and capped at 8,000
characters (`formatCaptureOutline`). No HTML or scripts. Agents get it framed as third-party content the owner wants
something similar to: untrusted data, never instructions, and never to copy its logos, brand names, images or texts.
The source URL is the owner's own; the dialog opens it with `rel="noopener noreferrer"`.

## File uploads

- Workspace logos: PNG, JPEG, WebP or GIF only, ≤ 1 MB, checked on the client and again on the server. Card references:
  see [Card references](#card-references).
- **SVG is rejected** on purpose: it can carry scripts and would be served from the app's own origin.
- Stored in a private bucket under a random UUID key; served with `X-Content-Type-Options: nosniff` and
  `Cache-Control: private`.
- Server Action body limit is raised to 6 MB (`next.config.ts`) to fit a 5 MB skill upload, a 5 MB card reference (one
  per call) and the 1 MB logo, plus multipart overhead.

## Redirects and CSRF

- Post-auth destinations (`next`) must be same-origin relative paths (`isSafeRedirectPath`: starts with `/`, not `//`
  or `/\`), which prevents open redirects.
- Server Actions are protected by Next.js's Origin check (same-origin only by default).
- The OAuth `state` and the short-lived, path-scoped `github_oauth` / `auth_next` cookies protect the redirect flows.

## Known gaps

| Gap | Risk | Suggested fix |
| --- | --- | --- |
| Agents can be steered by a malicious issue within their tools (e.g. a harmful code change on their branch). | A bad PR. Nothing merges without review + tests, and auto-merge is off by default. | Keep auto-merge off for repos that accept issues from outsiders; review agent PRs. |
| An uploaded skill's guidance can be subtly wrong or steer code style without tripping the scan. | Worse code on an agent branch; reviews and the human gate still apply. | Review skills before assigning them; prefer built-ins; keep their findings visible. |
| The agent log stores tool targets and the first line of tool answers (paths, error messages). | Repository paths and error text are kept in Postgres. File contents never are (reads store no summary). | Nothing needed; keep `toolStep` from summarizing read tools. |
| A link capture is a real browser on the internet with the sandbox host's IP. | The owner can make the host fetch any public page (and what it loads), up to 60 MB per capture. Nothing internal is reachable (see [Link captures](#link-captures)). | Owner-only action, one capture at a time; per-user limits with the rate limiting below. |
| No rate limiting on Server Actions or route handlers. | Brute-force or abuse of create/sync endpoints. | Add per-user limits (e.g. Upstash Ratelimit) on sync, create and run. |
| Workspaces have no members or roles. | Not a risk today, but anything shared later needs an access model. | Add memberships before any sharing feature. |
| Disconnecting GitHub doesn't revoke the token on GitHub. | The (encrypted, deleted) token stays valid on GitHub's side until the user revokes it. | Call GitHub's "delete an app token" endpoint on disconnect. |
| Caddy mounts the Docker socket (caddy-docker-proxy reads container labels). | A compromised Caddy, which faces the internet, could control Docker on the sandbox host (root-equivalent there, not in the app). | A Docker socket proxy that only allows reading containers and networks. |
| The sandbox's install step has network, and packages' install scripts run there. | A malicious dependency can reach the internet during install. It still runs under gVisor and the limits, with no secrets inside, on a network kept off private ranges (`techteam-sandbox`), and the command step has no network. | Allow-list registries through a proxy; per-volume disk quotas. |
| Content Security Policy is not configured. | Defense-in-depth only. | Add CSP headers in `next.config.ts` or `proxy.ts`. |
| The repository a workspace links to is fixed at creation. | If access is lost, the board can't sync (it says so). | Add a "change repository" setting with the same re-check as creation. |

## Checklist for new code

- [ ] Pages/actions call `requireUser()`; route handlers call `getCurrentUser()`.
- [ ] Every id from the request is loaded with an owner-scoped query.
- [ ] Server-side validation for every field, with allowlists and length caps.
- [ ] New secrets go in `.env` and `.env.example` (placeholder), and are read only in `server-only` modules.
- [ ] No tokens, keys or object keys in responses, logs or client props.
- [ ] Redirect targets go through `isSafeRedirectPath`.
