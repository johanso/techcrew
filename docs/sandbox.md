# Agent sandbox

Agents with the **Run tests in a sandbox** permission (`tests.run`; on for the Developer and the Tester by default) can
run the repository's code: install its dependencies, run its tests and build, or one command. They run in throwaway
Docker containers under [gVisor](https://gvisor.dev) on a Docker host, a VPS in practice. Introduced in v0.6
(milestone 1); previews of each pull request and a browser for the Tester came in milestone 2. See the
[roadmap](roadmap.md#v06--sandbox).

## How a call runs

```
Agent turn ─▶ run_tests / run_build / run_command          (lib/agent-tools.ts)
               └─ app: latest commit of the working branch, tarball from GitHub (the token stays in the app)
                    └─ docker CLI at SANDBOX_DOCKER_HOST     (lib/sandbox/docker.ts)
                         1. prepare (network on):  unpack over the last checkout, install if package.json,
                            the lockfile or the install command changed
                         2. command (network off): the test, build or command
                    └─ report: Passed / Failed / Timed out + the end of the output (12,000 characters)
```

- **One volume per run** (`techteam-run-<id>`) holds the checkout and `node_modules`, so a run installs once and later
  calls only unpack the new commit. It's removed when the run ends (`finishRun`); a sweep (at most once an hour, started
  by a sandbox call) removes volumes older than 12 hours that no container uses. Settings → **Test the sandbox** uses `techteam-check-<workspace id>`.
- **No secrets inside.** The repository goes in as a tarball piped through the CLI. The GitHub token, the AI keys and
  the app's environment never reach a container (the CLI itself gets only `PATH`, `HOME` and `DOCKER_HOST`).
- **No network for the code.** Only the install step has network (package registries). Tests, builds and commands run
  with `--network=none`, so the repository's code can't call out.
- **Limits** per container: gVisor (`--runtime=runsc`), 2 CPUs, 3 GB of memory and no swap, 512 processes, no
  capabilities, `no-new-privileges`, read-only root filesystem with a 1 GB `/tmp`, user `node`. A call has 5 minutes in
  all (`SANDBOX_TIMEOUT_SECONDS`); on timeout the container is killed by name.
- **One call at a time per volume** in the app process, so two calls never unpack over each other.

## What agents see

| Tool | When | Runs |
| --- | --- | --- |
| `run_tests` | Development and testing, with `tests.run`, when a test command is saved | The test command |
| `run_build` | Same, when a build command is saved | The build command |
| `run_command` | Same | One line the agent writes (≤ 300 characters), e.g. one test file or the type checker |

All three run on the working branch's latest commit. The stage protocol changes with them: the Developer is told to
run the tests and the build and fix what it broke before `submit_work`; the Tester runs them itself and fails the card
when they fail. Reviewers, Security and the Lead never get them.

**Draft with AI** follows the same conditions: it writes instructions that run the tests and the build only for the
Developer or the Tester with `tests.run` while the sandbox is on, and says "can't run code" otherwise.

The agent log records each call as the command plus its first line ("Passed: npm test (exit 0, 3.1 s)"), never the
output: it's the repository's. Failed and timed-out runs show as failures.

## Settings → Sandbox

`#sandbox` on the Settings page:
- **Let agents run code in the sandbox** (off by default). Can't be switched on when the server has no
  `SANDBOX_DOCKER_HOST`, or with neither a test nor a build command.
- **Install / test / build commands**, prefilled from the default branch's `package.json` and root lockfiles
  (`detectCommands`: `npm ci` with a package-lock, pnpm or yarn through `npx`, `npm test` unless it's npm's placeholder,
  `npm run build`). Saved with the switch, so a run never guesses them. One line each.
- **Test the sandbox** runs the saved install and test (else build) on the default branch and shows the outcome and
  the end of the output. The output is shown, never stored.

## Previews

With **Settings → Sandbox → Previews of pull requests** on (`workspaces.sandbox_preview`; needs the sandbox on, a
preview command, `SANDBOX_DOCKER_HOST` and `SANDBOX_PREVIEW_DOMAIN`), each agent pull request gets a live preview once
the CI gate passes: `https://pr-<n>-<6 random [a-z0-9]>.<SANDBOX_PREVIEW_DOMAIN>`, so the address can't be guessed.

```
CI gate passed ─▶ preview-<round>-start (Inngest step, beside the reviews)   lib/sandbox/preview.ts startRunPreview
                   1. network techteam-preview-run-<id>, --internal (no route out); Caddy joins it
                   2. volume techteam-preview-run-<id>: prepare like any call (tarball in, install with network)
                   3. container techteam-preview-run-<id> on that network only: the preview command,
                      PORT=4173 HOST=0.0.0.0, same limits as the sandbox, Caddy labels with the public host
               ─▶ preview-<round>-poll-<n> every 10 s: running once it answers on its network address,
                   failed if the command exits or nothing answers within 8 minutes
```

- **Preview command** (`SandboxCommands.preview`, saved with the others; rows saved before it read as null):
  detected from package.json. Next.js: build, then `next start -H 0.0.0.0 -p 4173`. Vite: build, then
  `vite preview --host 0.0.0.0 --port 4173 --strictPort`. Otherwise the `start` script (built first when there's a
  build). Binaries come from node_modules (`npx --no`): the preview has no network, so the build runs in it too.
- **State** lives in `agent_runs.preview` (`RunPreview`: status starting / running / failed / stopped, host, PR
  number, round, commit, times, a reason in the app's words). One per run: a rework round restarts it on the new
  commit under the same host; a new run on the same pull request gets a new host and stops the old one.
- **Its own volume**, not the run's (`techteam-run-<id>`): the Tester's `run_tests` / `run_build` unpack over that
  checkout and replace `dist/` or `.next/` while the preview serves them, and `finishRun` removes it at
  `awaiting_merge`, exactly when a preview is most useful. The cost is one more install per run.
- **No network for the code.** The preview network is `--internal`: no route out and no DNS for outside names. Only
  Caddy (and a browser) shares it, and Caddy listens on nothing there: it binds 80/443 to its own network's fixed
  address (`default_bind 172.31.254.2`) and its admin API to its loopback, so it only dials out to the preview.
- **No host services for containers.** `deploy/setup.sh` adds a ufw rule that refuses anything arriving from a Docker
  bridge (`docker0`, `br-*`) at the host itself: without it, SSH answered at every bridge's gateway and the public IP
  from inside a container (preview, browser or prepare). Containers' internet traffic is forwarded, not input, so
  installs still work; SSH from outside is untouched.
- **HTTPS** comes from [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) (`techteam-caddy`,
  run by `deploy/setup.sh`): each preview container carries `caddy=<host>`,
  `caddy.reverse_proxy={{upstreams 4173}}` and `caddy_ingress_network=<its network>`, so Caddy routes the host to it
  and gets that host's certificate over HTTP-01. Only running previews have a site, so an unknown host gets no
  certificate and no content.
- **Vite's host check**: the container gets `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<container>,<public host>`, so
  `vite preview` answers both the internal name and the public host.
- **Stopped** when the pull request is merged or closed (`completeMerge`, `closeWithoutMerge`: the merge paths, the
  board sync and the Pull Requests page), when the run is stopped or replaced (`finishRun` with `cancelled`,
  `replaceWaitingRuns`), and two hours after it started (`preview-sweep`, an Inngest cron every 10 minutes, which also
  removes leftovers of previews that already ended). A run that fails keeps its preview until one of those.
- **Agent log**: one `preview` row per round, after the development stage: the host and "Running at … (ready in
  23.0 s, commit abc1234)" or why it failed. Never the output.
- **Links**: "View preview" in the card's ⋯ menu and on the Pull Requests row while the preview is running.
- **For a browser on the host** (`getRunPreviewEndpoint(runId)`): join `previewTarget(runId).network` and open
  `internalUrl`. Docker's embedded DNS doesn't answer inside gVisor containers, so a browser under `runsc` needs
  `--add-host=<container>:<address>` (the endpoint's `address`).

## The Tester's browser

With previews on, the Tester (`testing` stage, `tests.run`) gets `browse_preview` (`lib/sandbox/browser.ts`, pure
parts in `browser-config.ts`). One call = one throwaway browser container:

```
browse_preview { path, viewport: desktop | mobile, steps: [click | fill | press | wait_for | goto …] }
  └─ docker network inspect techteam-preview-run-<id>: internal, preview container attached? else "No preview is running"
  └─ techteam-browser:1.64.1 (Playwright + Chromium), on that network only, --add-host=<container>:<its address>
       opens internalUrl + path, runs the steps in order, returns status, console and page errors, failed requests,
       an outline of the page (≤ 6,000 characters) and a PNG screenshot
```

- **Stateless**: every call is a fresh browser; steps run in order and stop at the first that fails. At most 15 steps,
  10 s each, 60 s per call (the container is killed by name after that). Calls are serialized per run.
- **Arguments are validated** (`parseBrowseArgs`): paths only (no absolute or protocol-relative URLs, no backslashes),
  `goto` on the same origin, each element named exactly one way (role + name, text or selector). They reach the runner
  as JSON on stdin, never through a shell.
- **Limits**: gVisor, 1 CPU, 1.5 GB, 256 processes, no capabilities, `no-new-privileges`, read-only root with a 512 MB
  `/tmp`, user `pwuser`, `--pull=never` (a registry image with the same name isn't ours). Chromium's own sandbox stays
  on (renderers get their own namespaces under gVisor); `--disable-dev-shm-usage` instead of `--ipc=host`,
  `--disable-gpu`. The runner aborts requests to other origins, blocks service workers and downloads, closes popups.
- **No internet**: the preview network is internal; Docker's DNS doesn't answer under gVisor, hence `--add-host`.
- **What's kept**: the agent gets the text report. The agent log keeps the path and the report's first line ("Opened
  /x: 200, 2 console errors, …"), which is built from our own data, never page text. The screenshot goes to private
  S3 (`run-screenshots/<workspace>/<run>/<uuid>.png`, key in `agent_run_steps.screenshot_key`) and shows as a
  thumbnail in the agent log, served by `/api/runs/<run>/steps/<step>/screenshot` to the workspace owner only.
- **The image** is built on the sandbox host from `deploy/browser/` (`SANDBOX_BROWSER_IMAGE` overrides the tag):
  `docker --context <host> build --pull -t techteam-browser:1.64.1 deploy/browser` from a checkout of this repo.

## Setting up a host

1. A fresh Ubuntu 24.04 VPS, then as root: `bash deploy/setup.sh` (firewall, swap, Docker with ports on localhost by
   default, gVisor, a `techteam` user, the `node:24-bookworm` image, Caddy on 80/443 for previews). Once you can log
   in as `techteam` with a key:
   `bash deploy/setup.sh --lock-ssh` (keys only, no root login). The script is idempotent; run it again on a new VPS.
2. In the app's environment: `SANDBOX_DOCKER_HOST=ssh://techteam@<ip>` (or a `~/.ssh/config` alias). When the app runs
   on the VPS itself: `unix:///var/run/docker.sock`. `SANDBOX_IMAGE` overrides the image.
3. From a laptop over SSH, every `docker` call opens SSH connections: turn on connection reuse for the host
   (`ControlMaster auto`, `ControlPath ~/.ssh/cm-%r@%h-%p`, `ControlPersist 10m`) or each call takes 10 s more.
   On the VPS a container starts in about 0.3 s.
4. Previews: a wildcard DNS record `*.preview.<your domain>` → the VPS, then `SANDBOX_PREVIEW_DOMAIN=preview.<your
   domain>`. To try certificates without Let's Encrypt's rate limits first, run the script once with
   `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`, then again without it (Caddy is recreated
   when its CA changes and rejoins the running previews' networks).
5. The Tester's browser: build `techteam-browser:1.64.1` on the host from `deploy/browser/` (see above).

## Limits today

- **Node repositories only.** Detection reads `package.json`; other stacks can type their own commands, but the image
  is `node:24-bookworm`.
- **Install scripts run with network.** Packages' `postinstall` scripts run during install, as on any machine; the
  limits and gVisor still apply, and nothing secret is inside.
- **No disk quota per volume** yet; the sweep and the per-run removal keep the host clean.
- **The browser sees only the preview**: no real devices, email or payments; the Tester names those as manual checks.
- **Screenshots stay in S3** when a run or workspace is deleted (no cleanup yet).
- **A certificate per preview.** Each preview host gets its own HTTP-01 certificate. Let's Encrypt allows 50 new
  certificates per registered domain per week (without CADDY_ACME_CA, Caddy falls back to ZeroSSL); a wildcard
  certificate would need DNS-01 through the DNS provider's API.
- **One preview at a time per run, on one host**: previews share the sandbox host's CPU and memory with agent calls
  (the same per-container limits).
