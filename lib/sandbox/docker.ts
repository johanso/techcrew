import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  BRIDGE_INSPECT_FORMAT,
  PREVIEW_PORT,
  SANDBOX_DNS_VOLUME,
  SANDBOX_NETWORK,
  SANDBOX_SUBNET,
  SANDBOX_TIMEOUT_SECONDS,
  bridgeNetworkProblem,
  outputTail,
  previewTarget,
  sandboxResolvConf,
  type SandboxRun,
} from "@/lib/sandbox/config";

/**
 * Sandboxes on Docker, driven through the `docker` CLI at SANDBOX_DOCKER_HOST (`ssh://user@host` for a VPS,
 * `unix:///var/run/docker.sock` when the app runs next to Docker). Each call runs two throwaway containers under gVisor
 * on one volume per key (a run, or a Settings check):
 * 1. prepare, with network: unpack the repository tarball (piped in, so no token enters a container) over the
 *    previous checkout, and install dependencies when package.json or the lockfile changed since the last install.
 *    It runs on techteam-sandbox (SANDBOX_NETWORK), a bridge whose subnet deploy/setup.sh keeps off private ranges,
 *    with public resolvers (SANDBOX_DNS_VOLUME);
 * 2. the command, without network: the repository's code never reaches the internet.
 * Both run as an unprivileged user with CPU, memory, process and time limits and a read-only root filesystem.
 * A preview (launchPreview) prepares its own volume the same way, then keeps one container serving the app on an
 * internal network that only Caddy joins.
 */

export function sandboxHost() {
  return process.env.SANDBOX_DOCKER_HOST?.trim() || null;
}

const image = () => process.env.SANDBOX_IMAGE?.trim() || "node:24-bookworm";

const LABEL = "techteam.sandbox=1";
const HOME = "/home/node";
const OUTPUT_KEEP = 64_000;
const TARBALL_MAX_BYTES = 300 * 1024 * 1024;
const KILL_GRACE_MS = 15_000;
const PREPARED = "[techteam] checkout ready";

const LIMITS = [
  "--runtime=runsc",
  "--cpus=2",
  "--memory=3g",
  "--memory-swap=3g",
  "--pids-limit=512",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--read-only",
  "--tmpfs=/tmp:rw,exec,nosuid,size=1g",
  "--user=node",
  "--env=CI=true",
  `--label=${LABEL}`,
  "--pull=missing",
];

// Unpack over the last checkout but keep node_modules; reinstall only when the manifest, lockfile or command changed.
const PREPARE_SCRIPT = `
mkdir -p repo && cd repo || exit 90
find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + || exit 90
tar -xzf - --strip-components=1 --no-same-owner || exit 90
echo "${PREPARED}"
[ -n "$TECHTEAM_INSTALL" ] || exit 0
STAMP="$(cat package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock 2>/dev/null | sha256sum | cut -d' ' -f1) $TECHTEAM_INSTALL"
if [ -d node_modules ] && [ "$(cat ../.techteam-install 2>/dev/null)" = "$STAMP" ]; then echo "[techteam] dependencies unchanged"; exit 0; fi
echo "[techteam] $ $TECHTEAM_INSTALL"
sh -c "$TECHTEAM_INSTALL" || exit $?
echo "$STAMP" > ../.techteam-install
`;

type DockerResult = { code: number | null; output: string; timedOut: boolean };

function docker(args: string[], options: { input?: Readable; timeoutMs?: number; name?: string } = {}): Promise<DockerResult> {
  const host = sandboxHost();
  if (!host) return Promise.reject(new Error("No sandbox host: set SANDBOX_DOCKER_HOST."));
  return new Promise((resolve, reject) => {
    // Only what the CLI needs: HOME holds the SSH config and keys for ssh:// hosts. The app's secrets stay out.
    const child = spawn("docker", args, {
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DOCKER_HOST: host },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_KEEP * 2) output = output.slice(-OUTPUT_KEEP);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);

    let timedOut = false;
    let fallback: NodeJS.Timeout | undefined;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          // Killing the CLI wouldn't stop a remote container: kill it by name, then the CLI if it hangs on.
          if (options.name) docker(["kill", options.name]).catch(() => undefined);
          fallback = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        }, Math.max(options.timeoutMs, 1))
      : undefined;

    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      resolve({ code, output: output.length > OUTPUT_KEEP ? output.slice(-OUTPUT_KEEP) : output, timedOut });
    });
    // The container may exit before reading everything (a bad archive): that's its answer, not a crash here.
    child.stdin.on("error", () => undefined);
    if (options.input) {
      options.input.on("error", () => child.stdin.destroy());
      options.input.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
  });
}

// ── Networks ───────────────────────────────────────────────────────────────────

const NETWORK_TIMEOUT_MS = 30_000;

/**
 * A bridge network with internet for containers that need it (the install step here, link captures in capture.ts),
 * created on first use: icc off and a fixed subnet, which deploy/setup.sh's DOCKER-USER rules keep off private
 * ranges. A network with that name but another shape is refused rather than used: the firewall rules match the
 * subnet. Returns a message for the owner when the network can't be used, else null.
 */
export async function ensureBridgeNetwork(network: { name: string; subnet: string; label: string; what: string }): Promise<string | null> {
  const inspect = () => docker(["network", "inspect", `--format=${BRIDGE_INSPECT_FORMAT}`, network.name], { timeoutMs: NETWORK_TIMEOUT_MS });
  let inspected = await inspect();
  if (inspected.code !== 0) {
    const created = await docker(
      ["network", "create", `--subnet=${network.subnet}`, "--opt=com.docker.network.bridge.enable_icc=false", `--label=${network.label}`, network.name],
      { timeoutMs: NETWORK_TIMEOUT_MS }
    );
    // Two calls at once may both try: the loser finds it made.
    if (created.code !== 0) console.error(`[sandbox] ${network.name} not created`, created.output.trim().slice(-300));
    inspected = await inspect();
    if (inspected.code !== 0) return `The sandbox host couldn't set up the ${network.what}.`;
  }
  const problem = bridgeNetworkProblem(inspected.output, network.subnet);
  if (problem) {
    console.error(`[sandbox] ${network.name} exists with ${problem}`);
    return `The ${network.what} on the sandbox host isn't set up as expected.`;
  }
  return null;
}

// Set up once per app process; cleared when it fails or Docker can't find the network or the volume any more.
let installNetwork: Promise<string | null> | null = null;

/**
 * The install step's network (SANDBOX_NETWORK) and its resolv.conf volume (SANDBOX_DNS_VOLUME, rewritten here so a
 * changed list of resolvers reaches the host). The volume isn't labeled as a sandbox volume, so the sweep keeps it.
 */
function ensureInstallNetwork(): Promise<string | null> {
  installNetwork ??= (async () => {
    const problem = await ensureBridgeNetwork({ name: SANDBOX_NETWORK, subnet: SANDBOX_SUBNET, label: "techteam.install-network=1", what: "install network" });
    if (problem) return problem;
    const volume = await docker(["volume", "create", "--label=techteam.install-network=1", SANDBOX_DNS_VOLUME], { timeoutMs: NETWORK_TIMEOUT_MS });
    if (volume.code !== 0) return "The sandbox host couldn't set up the install network's DNS.";
    // Root writes the file (the volume's root is root's); no network, our own content on stdin.
    const written = await docker(
      ["run", "--rm", "-i", ...LIMITS.filter((flag) => flag !== "--user=node"), "--user=root", "--network=none"]
        .concat([`--mount=type=volume,src=${SANDBOX_DNS_VOLUME},dst=/dns`, image()])
        .concat(["sh", "-c", "cat > /dns/resolv.conf.new && chmod 644 /dns/resolv.conf.new && mv /dns/resolv.conf.new /dns/resolv.conf"]),
      { input: Readable.from([sandboxResolvConf()]), timeoutMs: SANDBOX_TIMEOUT_SECONDS * 1000 }
    );
    if (written.code !== 0) {
      console.error("[sandbox] resolv.conf not written", written.output.trim().slice(-300));
      return "The sandbox host couldn't set up the install network's DNS.";
    }
    return null;
  })().then(
    (problem) => {
      if (problem) installNetwork = null;
      return problem;
    },
    (error: unknown) => {
      installNetwork = null;
      throw error;
    }
  );
  return installNetwork;
}

/** The prepare container's network flags: the install network, with public resolvers mounted read-only. */
const INSTALL_NETWORK_FLAGS = [
  `--network=${SANDBOX_NETWORK}`,
  `--mount=type=volume,src=${SANDBOX_DNS_VOLUME},dst=/etc/resolv.conf,volume-subpath=resolv.conf,readonly`,
];

const volumeName = (key: string) => `techteam-${key.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
const containerName = (key: string, step: string) => `${volumeName(key)}-${step}-${randomBytes(3).toString("hex")}`;

/** A tarball stream capped in size, so a huge repository can't fill the sandbox host's disk. */
function capped(stream: ReadableStream<Uint8Array>) {
  let bytes = 0;
  return Readable.fromWeb(stream as NodeReadableStream<Uint8Array>).pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > TARBALL_MAX_BYTES ? new Error("The repository archive is larger than the sandbox allows.") : null, chunk);
      },
    })
  );
}

// One call at a time per volume: two calls on one checkout would unpack over each other.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

type RepoSource = () => Promise<ReadableStream<Uint8Array> | null>;

type Prepared =
  | { ok: true; installLog: string }
  | { ok: false; failedStep: "prepare" | "install"; exitCode: number | null; timedOut: boolean; output: string };

/**
 * Step 1 of every call: the key's volume, then the prepare container (with network) unpacks the tarball over the last
 * checkout and installs when needed. Throws only when Docker refuses the volume.
 */
async function prepareCheckout(input: { key: string; source: RepoSource; install: string | null; deadline: number; labels?: string[] }): Promise<Prepared> {
  const volume = volumeName(input.key);
  const created = await docker(["volume", "create", `--label=${LABEL}`, ...(input.labels ?? []), volume]);
  if (created.code !== 0) throw new Error(`The sandbox host refused to create a volume: ${created.output.trim().slice(0, 300)}`);

  const networkProblem = await ensureInstallNetwork();
  if (networkProblem) return { ok: false, failedStep: "prepare", exitCode: null, timedOut: false, output: networkProblem };

  const archive = await input.source();
  if (!archive) return { ok: false, failedStep: "prepare", exitCode: null, timedOut: false, output: "Couldn't download the repository from GitHub." };

  const prepareName = containerName(input.key, "prepare");
  const prepare = await docker(
    ["run", "--rm", "-i", `--name=${prepareName}`, ...LIMITS, ...INSTALL_NETWORK_FLAGS, `--mount=type=volume,src=${volume},dst=${HOME}`, `--workdir=${HOME}`]
      .concat(input.install ? [`--env=TECHTEAM_INSTALL=${input.install}`] : [])
      .concat([image(), "sh", "-c", PREPARE_SCRIPT]),
    { input: capped(archive), timeoutMs: input.deadline - Date.now(), name: prepareName }
  );
  if (prepare.timedOut || prepare.code !== 0) {
    // 125: Docker refused to start the container (network or DNS volume removed since): set them up again next time.
    if (prepare.code === 125) installNetwork = null;
    const unpacked = prepare.output.includes(PREPARED);
    return { ok: false, failedStep: unpacked ? "install" : "prepare", exitCode: prepare.code, timedOut: prepare.timedOut, output: prepare.output };
  }
  return { ok: true, installLog: prepare.output.split(PREPARED)[1]?.trim() ?? "" };
}

/**
 * Unpacks the repository from `source` into the key's volume, installs when needed and runs `command`. Never throws
 * for what happens inside the containers (that's the report); throws only when Docker itself can't be reached.
 */
export function runInSandbox(input: {
  key: string;
  source: RepoSource;
  install: string | null;
  command: string;
  timeoutMs?: number;
}): Promise<SandboxRun> {
  return serialized(input.key, async () => {
    sweepOldVolumes();
    const started = Date.now();
    const deadline = started + (input.timeoutMs ?? SANDBOX_TIMEOUT_SECONDS * 1000);
    const volume = volumeName(input.key);
    const done = (rest: Omit<SandboxRun, "command" | "durationMs">): SandboxRun => ({
      command: input.command,
      durationMs: Date.now() - started,
      ...rest,
      output: outputTail(rest.output),
    });

    const prepared = await prepareCheckout({ key: input.key, source: input.source, install: input.install, deadline });
    if (!prepared.ok) {
      const { ok: _ok, ...failure } = prepared;
      return done(failure);
    }

    const commandName = containerName(input.key, "command");
    const run = await docker(
      ["run", "--rm", `--name=${commandName}`, ...LIMITS, "--network=none", `--mount=type=volume,src=${volume},dst=${HOME}`, `--workdir=${HOME}/repo`]
        .concat([image(), "sh", "-c", input.command]),
      { timeoutMs: deadline - Date.now(), name: commandName }
    );
    return done({
      exitCode: run.code,
      timedOut: run.timedOut,
      failedStep: run.timedOut || run.code !== 0 ? "command" : null,
      output: [prepared.installLog, `[techteam] $ ${input.command}`, run.output].filter(Boolean).join("\n"),
    });
  });
}

// ── Previews ───────────────────────────────────────────────────────────────────

/** The reverse proxy deploy/setup.sh runs (caddy-docker-proxy): it serves each preview's public host over HTTPS. */
export const PREVIEW_PROXY = "techteam-caddy";
const PREVIEW_LABEL = "techteam.preview";
const PREVIEW_RUN_LABEL = "techteam.preview.run";
// The volume key whose name (volumeName) is the preview's container and network name: techteam-preview-run-<id>.
const previewKey = (runId: number) => `preview-run-${runId}`;

// Any HTTP answer counts: the server is up. Run inside the preview container against its address on the network,
// so a server listening only on 127.0.0.1 (unreachable for Caddy and the browser) doesn't pass.
const PROBE_SCRIPT = `fetch(process.argv[1], { redirect: "manual", signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))`;

export type PreviewLaunch = { ok: true } | { ok: false; reason: string };

/**
 * Starts (or, on a rework round, restarts) a run's preview: an `--internal` network (no route out) shared only with
 * Caddy, the run's own preview volume prepared like any sandbox call (tarball in, install with network), then the
 * preview container on that network alone, with the sandbox limits, serving `command` on PREVIEW_PORT. Caddy picks the
 * container up by its labels. Returns once the container started; probePreview says when it answers.
 */
export function launchPreview(input: {
  runId: number;
  host: string;
  source: RepoSource;
  install: string | null;
  command: string;
  timeoutMs: number;
}): Promise<PreviewLaunch> {
  const target = previewTarget(input.runId);
  const key = previewKey(input.runId);
  return serialized(key, async () => {
    sweepOldVolumes();
    const deadline = Date.now() + input.timeoutMs;
    const labels = [`--label=${PREVIEW_LABEL}=1`, `--label=${PREVIEW_RUN_LABEL}=${input.runId}`];

    // The previous round's server goes first (same name); the network, Caddy's link and node_modules stay.
    await docker(["rm", "--force", target.container]);
    const network = await docker(["network", "inspect", "--format={{.Name}}", target.network]);
    if (network.code !== 0) {
      const created = await docker(["network", "create", "--internal", ...labels, target.network]);
      if (created.code !== 0 && !created.output.includes("already exists")) {
        throw new Error(`The sandbox host refused to create a network: ${created.output.trim().slice(0, 300)}`);
      }
    }
    // Before the container starts, so Caddy can reach it as soon as it sees it.
    const joined = await docker(["network", "connect", target.network, PREVIEW_PROXY]);
    if (joined.code !== 0 && !joined.output.includes("already exists")) {
      return { ok: false, reason: `The sandbox host has no HTTPS proxy (${PREVIEW_PROXY}). Run deploy/setup.sh on it.` };
    }

    const prepared = await prepareCheckout({ key, source: input.source, install: input.install, deadline, labels });
    if (!prepared.ok) {
      const where = prepared.failedStep === "install" ? "installing dependencies" : "preparing the checkout";
      return {
        ok: false,
        reason: prepared.timedOut
          ? `Timed out while ${where}.`
          : prepared.exitCode === null
            ? prepared.output
            : `Failed while ${where} (exit ${prepared.exitCode}).`,
      };
    }

    const started = await docker(
      ["run", "--detach", `--name=${target.container}`, ...LIMITS, ...labels, `--network=${target.network}`]
        .concat([`--mount=type=volume,src=${volumeName(key)},dst=${HOME}`, `--workdir=${HOME}/repo`])
        .concat([`--env=PORT=${PREVIEW_PORT}`, "--env=HOST=0.0.0.0"])
        // Vite answers only hosts it knows (DNS rebinding protection): the browser's internal name and the public host.
        .concat([`--env=__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${target.container},${input.host}`])
        .concat([`--label=caddy=${input.host}`, `--label=caddy.reverse_proxy={{upstreams ${PREVIEW_PORT}}}`, `--label=caddy_ingress_network=${target.network}`])
        .concat([image(), "sh", "-c", input.command])
    );
    if (started.code !== 0) return { ok: false, reason: "The sandbox host couldn't start the preview container." };
    return { ok: true };
  });
}

export type PreviewProbe = { state: "ready" } | { state: "waiting" } | { state: "exited"; exitCode: number | null } | { state: "missing" };

/** One readiness check: is the preview container still running, and does it answer on its network address? */
export async function probePreview(runId: number): Promise<PreviewProbe> {
  const target = previewTarget(runId);
  const inspected = await docker([
    "inspect",
    `--format={{.State.Status}} {{.State.ExitCode}} {{with index .NetworkSettings.Networks "${target.network}"}}{{.IPAddress}}{{end}}`,
    target.container,
  ]);
  if (inspected.code !== 0) return { state: "missing" };
  const [status, exitCode, ip] = inspected.output.trim().split(" ");
  if (status === "created" || status === "restarting") return { state: "waiting" };
  if (status !== "running") return { state: "exited", exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null };
  if (!ip) return { state: "waiting" };
  const probe = await docker(["exec", target.container, "node", "-e", PROBE_SCRIPT, `http://${ip}:${PREVIEW_PORT}/`], { timeoutMs: 15_000 });
  return probe.code === 0 ? { state: "ready" } : { state: "waiting" };
}

/**
 * The preview container's address on its network. Docker's embedded DNS doesn't answer inside gVisor containers, so
 * a container under runsc that opens `previewTarget(runId).internalUrl` needs `--add-host=<container>:<address>`.
 */
export async function previewAddress(runId: number): Promise<string | null> {
  const target = previewTarget(runId);
  const inspected = await docker(["inspect", `--format={{with index .NetworkSettings.Networks "${target.network}"}}{{.IPAddress}}{{end}}`, target.container]);
  const ip = inspected.output.trim();
  return inspected.code === 0 && /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}

/** Removes a run's preview: container, Caddy's link, network and volume. Never throws; the sweep retries what's left. */
export function removePreview(runId: number): Promise<void> {
  if (!sandboxHost()) return Promise.resolve();
  const target = previewTarget(runId);
  const key = previewKey(runId);
  return serialized(key, async () => {
    await docker(["rm", "--force", target.container]);
    await docker(["network", "disconnect", "--force", target.network, PREVIEW_PROXY]);
    await docker(["network", "rm", target.network]);
    await docker(["volume", "rm", "--force", volumeName(key)]);
  }).catch(() => undefined);
}

/** Runs with a preview network on the sandbox host, and when it was created (for the sweep). */
export async function listPreviewNetworks(): Promise<{ runId: number; createdAt: Date }[]> {
  const listed = await docker(["network", "ls", "--quiet", `--filter=label=${PREVIEW_RUN_LABEL}`]);
  const ids = listed.output.split("\n").map((id) => id.trim()).filter(Boolean);
  if (listed.code !== 0 || !ids.length) return [];
  const inspected = await docker(["network", "inspect", `--format={{index .Labels "${PREVIEW_RUN_LABEL}"}} {{.Created.Unix}}`, ...ids]);
  return inspected.output
    .split("\n")
    .map((line) => line.trim().split(" ").map(Number))
    .filter(([runId, created]) => Number.isSafeInteger(runId) && Number.isFinite(created))
    .map(([runId, created]) => ({ runId: runId!, createdAt: new Date(created! * 1000) }));
}

/** Removes a key's volume (its checkout and node_modules). Best effort: the sweep catches what this misses. */
export async function removeSandbox(key: string) {
  if (!sandboxHost()) return;
  await docker(["volume", "rm", "--force", volumeName(key)]).catch(() => undefined);
}

const VOLUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweep = 0;

/** At most once an hour, in the background: volumes left by runs that ended without cleaning up. */
function sweepOldVolumes() {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  void (async () => {
    const listed = await docker(["volume", "ls", "--quiet", `--filter=label=${LABEL}`]);
    const names = listed.output.split("\n").map((name) => name.trim()).filter(Boolean);
    if (listed.code !== 0 || !names.length) return;
    const inspected = await docker(["volume", "inspect", "--format={{.Name}} {{.CreatedAt}}", ...names]);
    const old = inspected.output
      .split("\n")
      .map((line) => line.trim().split(" "))
      .filter(([name, ...created]) => name && Date.now() - new Date(created.join(" ")).getTime() > VOLUME_MAX_AGE_MS)
      .map(([name]) => name!);
    // In use = a container still mounts it; Docker refuses to remove those, which is what we want.
    if (old.length) await docker(["volume", "rm", ...old]);
  })().catch(() => undefined);
}
