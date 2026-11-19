# Agent sandbox

Agents with the **Run tests in a sandbox** permission (`tests.run`; on for the Developer and the Tester by default) can
run the repository's code: install its dependencies, run its tests and build, or one command. They run in throwaway
Docker containers under [gVisor](https://gvisor.dev) on a Docker host, a VPS in practice. Introduced in v0.6
(milestone 1). Previews and a browser come in milestone 2; see the [roadmap](roadmap.md#v06--sandbox).

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

## Setting up a host

1. A fresh Ubuntu 24.04 VPS, then as root: `bash deploy/setup.sh` (firewall, swap, Docker with ports on localhost by
   default, gVisor, a `techteam` user, the `node:24-bookworm` image). Once you can log in as `techteam` with a key:
   `bash deploy/setup.sh --lock-ssh` (keys only, no root login). The script is idempotent; run it again on a new VPS.
2. In the app's environment: `SANDBOX_DOCKER_HOST=ssh://techteam@<ip>` (or a `~/.ssh/config` alias). When the app runs
   on the VPS itself: `unix:///var/run/docker.sock`. `SANDBOX_IMAGE` overrides the image.
3. From a laptop over SSH, every `docker` call opens SSH connections: turn on connection reuse for the host
   (`ControlMaster auto`, `ControlPath ~/.ssh/cm-%r@%h-%p`, `ControlPersist 10m`) or each call takes 10 s more.
   On the VPS a container starts in about 0.3 s.

## Limits today

- **Node repositories only.** Detection reads `package.json`; other stacks can type their own commands, but the image
  is `node:24-bookworm`.
- **Install scripts run with network.** Packages' `postinstall` scripts run during install, as on any machine; the
  limits and gVisor still apply, and nothing secret is inside.
- **No disk quota per volume** yet; the sweep and the per-run removal keep the host clean.
- **No browser yet**: UI checks still need a human (milestone 2).
