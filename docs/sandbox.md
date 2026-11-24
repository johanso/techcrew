# Agent sandbox

Agents with the **Run tests in a sandbox** permission (`tests.run`; on for the Developer and the Tester by default) can
run the repository's code: install its dependencies, run its tests and build, or one command. They run in throwaway
Docker containers, either on **this computer's own Docker** (local mode, v0.10) or on a prepared **remote host** under
[gVisor](https://gvisor.dev) (remote mode, a VPS in practice). Introduced in v0.5,
with previews of each pull request and a browser for the Tester. References on cards (images, documents, URLs) and the loose ends are v0.7; see
the [roadmap](roadmap.md#v07--card-references-and-sandbox-polish-).

**The sandbox is optional.** TechTeam itself runs on your computer without Docker, and without a sandbox the agents
still work: they edit through the GitHub API and rely on your repository's CI for tests and builds, and the Tester has
no preview or browser. The mode follows from the environment (`lib/sandbox/mode.ts`):

| Mode | When | Runs on |
| --- | --- | --- |
| `remote` | `SANDBOX_DOCKER_HOST` is set | A Docker host that `deploy/setup.sh` prepared (a VPS over SSH, or the local socket of a Linux machine set up the same way): gVisor, firewall rules, Caddy for previews. Unchanged since v0.5. |
| `local` | no host, and Docker answers on this computer with the two images installed | The Docker of your own computer: Docker Desktop on Windows or macOS, Docker Engine on Linux. No VPS, no Caddy, no domain. |
| unavailable | none of the above | Settings → Sandbox says why and how to fix it: Docker isn't installed, Docker Desktop isn't running, Docker is in Windows-containers mode, or the images are missing (`npm run sandbox:setup`). |

`TECHTEAM_SANDBOX=off` switches the sandbox off on a computer in either mode. The per-workspace switch (Settings →
Sandbox) stays opt-in. Not planned any more: a bubblewrap/WSL mode (see the [plan](local-first-plan.md#phase-8--pluggable-sandbox)).

## Local mode

What changes on your own Docker, and what it does **not** protect (read this before switching it on):

| | Remote host | Local Docker |
| --- | --- | --- |
| Runtime | gVisor (`runsc`): a user-space kernel between the code and the host | The default runtime. On Docker Desktop the containers live **inside its Linux VM**, so an escape lands in that VM, not on your computer; on Linux Docker Engine the host kernel is shared. |
| Install step's network | `techteam-sandbox` on a subnet that DOCKER-USER rules keep off private ranges | `techteam-sandbox` too (icc off, a subnet Docker picks), **without firewall rules**: nothing can keep a container away from your home network. |
| Install scripts | Run (with the network rules above) | **Off:** installs run with `--ignore-scripts` (`localInstallCommand`: `npm ci`, `npm install`, `pnpm install`, `yarn install`, also in chains with `&&` and after `npx` / env prefixes). Settings → Sandbox has **Allow install scripts (some packages need them)**, stored in `sandbox_commands` (`allowInstallScripts`, no migration; absent = off). Turn it on only for repositories you trust. The protection doesn't depend on the command's shape: the prepare container also gets `npm_config_ignore_scripts=true` and `YARN_IGNORE_SCRIPTS=true`, so a quoted `sh -c "npm ci"` or a wrapper stays script-free too. |
| Command step | `--network=none` | `--network=none`, the same |
| Previews | Caddy, HTTPS, `pr-<n>-<random>.<domain>` | `http://127.0.0.1:<port>`, loopback only (below) |
| The host's names | | `host.docker.internal` and `gateway.docker.internal` are pinned to `127.0.0.1` inside every container, so the usual names for your computer don't lead to it |
| Link captures | Yes | **No**: their safety rests on the host firewall (`linkCaptureAvailable()` is false; the link field says why) |

Always, in both modes (every argument list is built in `lib/sandbox/docker-args.ts` and one test checks them all): no
`--privileged`, no Docker socket, no bind mount of a host path (named volumes only), no `--network=host`, no added
capability, no device, no user but the unprivileged `node` (`pwuser` for the browser), no secret in a container's
environment or arguments, `--cap-drop=ALL`, `no-new-privileges`, a read-only root, CPU, memory, process and time limits.

What local mode does **not** give you: gVisor's second kernel, or a firewall for your home network. A package's install
script (when you allow scripts) and anything a preview's server does can talk to your LAN through the install network
(scripts) or nothing at all (previews are `--internal`). The default (scripts off) closes the first gap; for repositories
you don't trust, use a remote host.

**Setting up this computer:** install Docker (Docker Desktop with Linux containers, or Docker Engine), start it, then
`npm run sandbox:setup` once. It downloads the sandbox image (`node:24-bookworm`, `SANDBOX_IMAGE`) when it's missing and
builds the browser image from `deploy/browser` with the tag the app expects (`techteam-browser:1.64.1-3`,
`SANDBOX_BROWSER_IMAGE`); it prints the sizes, is safe to run again, never removes anything, and with
`-- --check` only reports. It refuses when `SANDBOX_DOCKER_HOST` is set (remote hosts are prepared by `deploy/setup.sh`)
unless you pass `-- --remote`. Then Settings → Sandbox → save the commands → **Test the sandbox**. `npm run doctor`
reports the same state.

**The status** (`lib/sandbox/status.ts`): `docker info --format "{{.OSType}}|{{.ServerVersion}}"` with a 5 s limit, then
`docker image inspect` for the two images; cached for 15 s and shared by every caller, so Settings, the pipeline and the
sweeps never ask Docker more often than that. Settings streams the Sandbox card inside a `Suspense` boundary, so the rest
of the page never waits for Docker, and a stopped engine answers in a moment (the CLI fails at once) with the card showing
the reason. The Docker CLI gets a tiny environment (`lib/sandbox/docker-env.ts`): `PATH`, `HOME` and, on Windows, what
Docker Desktop's CLI needs (`SystemRoot`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `PATHEXT` …), plus
`DOCKER_CONFIG` and `DOCKER_CONTEXT` when set. Never `DOCKER_HOST` and never the app's secrets.

## How a call runs

```
Agent turn ─▶ run_tests / run_build / run_command          (lib/agent-tools.ts)
               └─ app: latest commit of the working branch, tarball from GitHub (the token stays in the app)
                    └─ docker CLI, at SANDBOX_DOCKER_HOST or on this computer (lib/sandbox/docker.ts)
                         1. prepare (network techteam-sandbox: internet; remote: no private ranges; local: --ignore-scripts):
                            unpack over the last checkout, install if package.json, the lockfile or the install
                            command changed
                         2. command (network off): the test, build or command
                    └─ report: Passed / Failed / Timed out + the end of the output (12,000 characters)
```

- **One volume per run** (`techteam-run-<id>`) holds the checkout and `node_modules`, so a run installs once and later
  calls only unpack the new commit. It's removed when the run ends (`finishRun`); a sweep (at most once an hour, started
  by a sandbox call) removes volumes older than 12 hours that no container uses. Settings → **Test the sandbox** uses `techteam-check-<workspace id>`.
- **No secrets inside.** The repository goes in as a tarball piped through the CLI. The GitHub token, the AI keys and
  the app's environment never reach a container (the CLI itself gets only `PATH`, `HOME` and `DOCKER_HOST` on a remote host,
  see above for local).
- **No network for the code.** Only the install step has network (package registries). Tests, builds and commands run
  with `--network=none`, so the repository's code can't call out.
- **The install step's network** is `techteam-sandbox` (`SANDBOX_NETWORK`): a bridge on `172.31.252.0/24` with no
  traffic between containers (icc off), created by the app on first use (`ensureBridgeNetwork`, shared with link
  captures) and by `deploy/setup.sh`. A network with that name but another shape is refused, not used. `deploy/setup.sh`
  adds DOCKER-USER rules that refuse its traffic to private, loopback, link-local (cloud metadata), CGNAT, multicast and
  reserved ranges, the same rules as the capture network: a dependency's install script reaches the internet, never
  the provider's private network (10.x answered from containers on the default bridge). Previews prepare the same way.
- **DNS for installs**: on a user-defined network Docker points containers at its embedded resolver (`127.0.0.11`),
  which doesn't answer under gVisor, and `--dns` only changes that resolver's upstreams. So the app keeps a
  `resolv.conf` with public resolvers (1.1.1.1, 8.8.8.8, 9.9.9.9) in a small volume (`techteam-sandbox-dns`, written
  once per app process) and mounts it read-only over `/etc/resolv.conf` (`volume-subpath`, Docker 26 or later).
- **Limits** per container: gVisor (`--runtime=runsc`, remote only), 2 CPUs, 3 GB of memory and no swap, 512 processes, no
  capabilities, `no-new-privileges`, read-only root filesystem with a 1 GB `/tmp`, user `node`. A call has 5 minutes in
  all (`SANDBOX_TIMEOUT_SECONDS`); on timeout the container is killed by name.
- **One call at a time per volume** in the app process, so two calls never unpack over each other.

## What agents see

| Tool | When | Runs |
| --- | --- | --- |
| `run_tests` | Development and testing, with `tests.run`, when a test command is saved | The test command |
| `run_build` | Same, when a build command is saved | The build command |
| `run_command` | Same | One line the agent writes (≤ 300 characters), e.g. one test file or the type checker |

| `add_dependency` | Development, with `code.write` and `deps.manage` (not `tests.run`: it runs no code) | `npm install --package-lock-only --ignore-scripts` for one package, then a commit of package.json and the lockfile |

The first three run on the working branch's latest commit. The stage protocol changes with them: the Developer is told to
run the tests and the build and fix what it broke before `submit_work`; the Tester runs them itself and fails the card
when they fail. Reviewers, Security and the Lead never get them.

**Draft with AI** follows the same conditions: it writes instructions that run the tests and the build only for the
Developer or the Tester with `tests.run` while the sandbox is on, and says "can't run code" otherwise.

The agent log records each call as the command plus its first line ("Passed: npm test (exit 0, 3.1 s)"), never the
output: it's the repository's. Failed and timed-out runs show as failures.

## Adding a package

`add_dependency { name, version, dev }` (`lib/agent-tools.ts`, pure rules in `lib/sandbox/dependency-config.ts`) is
how the Developer adds an npm package: writing package.json by hand can't regenerate the lockfile, so `npm ci` would
fail in CI and in the sandbox.

```
add_dependency { name: "@fontsource/inter", version: null, dev: false }
  └─ validate: npm name; exact version, one simple range or latest (null)    parseDependencyArgs
  └─ root files of the branch's latest commit: package.json, and npm's lockfile or none; pnpm, Yarn and Bun
     lockfiles are refused with a message for the agent's result             dependencyPlan
  └─ volume techteam-deps-run-<id> (its own, removed afterwards)            lib/sandbox/docker.ts addPackageInSandbox
       1. prepare (network on, like every install): unpack the tarball, then
          npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-prod|--save-dev '<name>@<version>'
       2. read (network off): package.json and the lockfile back as JSON, ≤ 20 MB each
  └─ package.json declares it in the right section, the lockfile pins it    dependencyChange
  └─ one commit through the GitHub API (blobs, tree, commit, fast-forward the branch)   commitFiles
  └─ "Added @fontsource/inter@5.3.0 to dependencies ("^5.3.0"): committed package.json and package-lock.json to …"
```

- **Lockfile only.** npm resolves the package and rewrites both files without downloading tarballs or running any
  script, in about 5–10 s. The next `run_tests` / `run_build` sees the changed lockfile and reinstalls with `npm ci`.
- **Its own volume**, so the run's checkout and `node_modules` (`techteam-run-<id>`) stay as they were; removed after
  the call, and the hourly sweep catches leftovers.
- **npm only.** A repository with `pnpm-lock.yaml`, `yarn.lock` or `bun.lock(b)` is refused (the other lockfile would
  go stale); the agent says in its result which package is needed. Without any lockfile only package.json is
  committed, as the repository does today. The repository's `.npmrc` applies (`save-exact`, `legacy-peer-deps` …).
- **Fonts**: a font the card names is added as a bundled package (`@fontsource/<font>` or `@fontsource-variable/<font>`)
  and imported, so it ships with the build and loads in the preview, which has no internet (a Google Fonts `<link>` or
  `next/font/google` would fall back or fail there), and visitors never call a font host. The owner names the font in
  the card; agents don't pick one.
- **Errors** come back as text: npm's failure (a 404, a peer conflict) as the end of its output; a branch that moved
  while npm worked as "call add_dependency again" (the ref only fast-forwards); nothing new to commit as "already in".
- **Agent log**: the package (`@fontsource/inter@latest`) and the first line, never npm's output.

## Settings → Sandbox

`#sandbox` on the Settings page:
- **Let agents run code in the sandbox** (off by default). Can't be switched on while the sandbox is unavailable
  (the card shows the reason instead of the form), or with neither a test nor a build command.
- **Allow install scripts (some packages need them)**: local mode only, off by default (see [Local mode](#local-mode)).
- **Install / test / build commands**, prefilled from the default branch's `package.json` and root lockfiles
  (`detectCommands`: `npm ci` with a package-lock, pnpm or yarn through `npx`, `npm test` unless it's npm's placeholder,
  `npm run build`). Saved with the switch, so a run never guesses them. One line each.
- **Test the sandbox** runs the saved install and test (else build) on the default branch and shows the outcome and
  the end of the output. The output is shown, never stored.

## Previews

With **Settings → Sandbox → Previews of pull requests** on (`workspaces.sandbox_preview`; needs the sandbox on, a
preview command and, on a remote host, `SANDBOX_DOCKER_HOST` and `SANDBOX_PREVIEW_DOMAIN`), each agent pull request gets a
live preview once the CI gate passes: `https://pr-<n>-<6 random [a-z0-9]>.<SANDBOX_PREVIEW_DOMAIN>`, so the address can't
be guessed. **Locally** there is no Caddy, no domain and no HTTPS: the preview is `http://127.0.0.1:<port>`, a random
port bound to loopback, so only this computer reaches it. It stays on its `--internal` network exactly as on a remote
host; because Docker can't publish the ports of a container on an internal network, a small **forwarder** container
(`techteam-preview-run-<id>-fwd`, the sandbox image running 20 lines of our own `node` that pipe TCP to the preview's
address) is created on the default bridge with `--publish 127.0.0.1::4173`, joined to the preview's network and started;
the port is read back with `docker port`. The forwarder and the preview carry the preview labels and go together when the
preview stops (`removePreview`), and the sweeps only ever touch objects with the `techteam` labels. The preview's own
`host` identity is `pr-<n>-<random>.preview.localhost` (never resolved); its address is `RunPreview.url`. Vite's host
check allows `localhost` and `127.0.0.1` there.

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
- **For a browser on the sandbox host** (`getRunPreviewEndpoint(runId)`): join `previewTarget(runId).network` and open
  `internalUrl`. Docker's embedded DNS doesn't answer inside gVisor containers, so a browser under `runsc` needs
  `--add-host=<container>:<address>` (the endpoint's `address`).

## The Tester's browser

With previews on, the Tester (`testing` stage, `tests.run`) gets `browse_preview` (`lib/sandbox/browser.ts`, pure
parts in `browser-config.ts`). One call = one throwaway browser container:

```
browse_preview { path, viewport: desktop | tablet | mobile, color_scheme: light | dark, steps: [click | fill | press | wait_for | goto …] }
  └─ docker network inspect techteam-preview-run-<id>: internal, preview container attached? else "No preview is running"
  └─ techteam-browser:1.64.1-3 (Playwright + Chromium), on that network only, --add-host=<container>:<its address>
       opens internalUrl + path, runs the steps in order, returns status, console and page errors, failed requests,
       an outline of the page (≤ 6,000 characters) and a PNG screenshot
```

- **Viewports**: desktop 1280×800, tablet 768×1024 and mobile 375×812 (both with touch and the meta viewport);
  `color_scheme` sets `prefers-color-scheme` (Playwright's `colorScheme`), light by default.
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
  /x on tablet in dark mode: 200, 2 console errors, …"), which is built from our own data, never page text. The
  screenshot goes to local storage (`run-screenshots/<workspace>/<run>/<uuid>.png`, key in
  `agent_run_steps.screenshot_key`) and shows as a thumbnail in the agent log, served by
  `/api/runs/<run>/steps/<step>/screenshot` to the workspace owner only.
- **The Tester sees its screenshots** when its model has vision: the tool result carries a placeholder
  (`techteam-screenshot:<uuid>`), and each model request loads that file as base64 from
  `run-screenshots/<workspace>/<run>/<uuid>.png`, a key built from the run's own ids (`runScreenshotKey`), so a
  placeholder can only ever name a screenshot of that run. No base64 in the database or the Inngest state. Without
  vision the report says the screenshot is only in the agent log. Images in the history are sent again on every turn
  for Claude and OpenRouter (OpenAI keeps them server-side), so each browse adds to the next turns' input.
- **Comparing with the references**: on a card with image or link references, the Tester's protocol says to browse
  each changed page at the viewport closest to the reference's width (`closestViewport`; `list_references` names it),
  light and dark, and compare; a clear mismatch with what the brief says to follow is a test fail with the specific
  differences, which goes back to the Developer like any test fail.
- **The image** is built from `deploy/browser/` (`SANDBOX_BROWSER_IMAGE` overrides the tag): `npm run sandbox:setup` does
  it for this computer's Docker; for a remote host,
  `docker --context <host> build --pull -t techteam-browser:1.64.1-3 deploy/browser` from a checkout of this repo.
  The browser works the same in local mode: the default runtime, the same image, the preview's internal network and the
  preview's address by `--add-host`; its screenshots go to local storage as always.
  The tag is Playwright's version plus a revision of the folder (`-2`: link captures, tablet, color scheme; `-3`:
  fonts with real bold weights); bump the revision whenever anything in `deploy/browser/` changes (and list a new file
  in its `.dockerignore`).
- **Fonts**: the base image's default UI font (WenQuanYi Zen Hei) has no bold face, so until `-3` `system-ui`
  headings and 700-weight text rendered regular and the Tester could misjudge weight against a reference. The image
  adds Inter's variable font (`fonts-inter-variable`, 100–900, under 1 MB) and `fonts.conf` (installed as
  `/etc/fonts/local.conf`): `system-ui`, `ui-sans-serif`, `-apple-system`, `BlinkMacSystemFont` and `Segoe UI` render
  in Inter; Arial, Helvetica and Chromium's `sans-serif` in Liberation Sans; `serif` and `monospace` in Liberation
  Serif and Mono. All with real bold. A page's own web fonts still win; a page that names a font it doesn't bundle
  falls back to these (the preview has no internet).

## Link captures

A link reference on a card (References → **Add a link**) is captured once, when it's added, by the same image in its
`capture` mode (`lib/sandbox/capture.ts`, pure parts in `capture-config.ts`, runner `deploy/browser/capture.mjs`):

```
addCardLinkAction ─▶ parseCaptureUrl (net-guard.mjs: http/https, no credentials, ports 80/443/8080/8443,
                     no private address literal or internal name) ─▶ the app resolves the name: every address public?
                  ─▶ network techteam-capture (bridge, 172.31.253.0/24, icc off; created on first use)
                  ─▶ techteam-browser:1.64.1-3, the Tester's browser limits with 2 CPUs, on that network
                       Chromium ─▶ proxy in the container ─▶ resolves with public resolvers, checks every address,
                                                              connects to the address it checked
                       desktop 1280 px and mobile 375 px, full page up to 2,400 px, JPEG; outline of the page
                  ─▶ files: card-references/<workspace>/<card>/<uuid>.jpg ×2 + .txt (the outline), one task_references row
```

- **Once.** The capture is the reference: agents read the stored screenshots and outline (`read_reference`) and
  never browse the internet. A failed capture stores nothing and the dialog shows why (private address, name not
  found, too slow, HTTP error).
- **Limits.** 100 s per capture (container included; the page work gets 80 s), 2 CPUs (the sandbox host needs at
  least two), 20 s per page load, 60 MB downloaded and 400 connections per capture, screenshots ≤ 4 MB each, outline
  ≤ 8,000 characters. One capture at a time per app process.
- **What the page can reach**: see [security.md](security.md#link-captures).
- **Remote only.** Without a sandbox host (`SANDBOX_DOCKER_HOST` unset), including a computer that runs the sandbox on
  its own Docker, the link input is disabled with the reason: the safety of a capture rests on the host firewall rules.

## Setting up a remote host

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
5. The sandbox browser (the Tester's browser and link captures): build `techteam-browser:1.64.1-3` on the host from
   `deploy/browser/` (see above). `deploy/setup.sh` also creates the capture and install networks and their
   private-range firewall rules.

## Limits today

- **Node repositories only.** Detection reads `package.json`; other stacks can type their own commands, but the image
  is `node:24-bookworm`.
- **Install scripts run with network on a remote host.** Packages' `postinstall` scripts run during install (`npm ci`
  before tests, builds and previews), as on any machine; the limits and gVisor still apply, nothing secret is inside, and
  the install network keeps them off private ranges. `add_dependency` itself runs no scripts. In local mode they are off
  unless you allow them.
- **No disk quota per volume** yet; the sweep and the per-run removal keep the host clean.
- **The browser sees only the preview**: no real devices, email or payments; the Tester names those as manual checks.
- **Captures see the page as a first-time visitor**: no login, cookie banners included, no video; pages taller than
  2,400 px are cut.
- **Screenshots stay on disk** when a run or workspace is deleted (no cleanup yet).
- **A certificate per preview.** Each preview host gets its own HTTP-01 certificate. Let's Encrypt allows 50 new
  certificates per registered domain per week (without CADDY_ACME_CA, Caddy falls back to ZeroSSL); a wildcard
  certificate would need DNS-01 through the DNS provider's API.
- **One preview at a time per run, on one host**: previews share the sandbox host's CPU and memory with agent calls
  (the same per-container limits).
