import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { SANDBOX_TIMEOUT_SECONDS, outputTail, type SandboxRun } from "@/lib/sandbox/config";

/**
 * Sandboxes on Docker, driven through the `docker` CLI at SANDBOX_DOCKER_HOST (`ssh://user@host` for a VPS,
 * `unix:///var/run/docker.sock` when the app runs next to Docker). Each call runs two throwaway containers under gVisor
 * on one volume per key (a run, or a Settings check):
 * 1. prepare, with network: unpack the repository tarball (piped in, so no token enters a container) over the
 *    previous checkout, and install dependencies when package.json or the lockfile changed since the last install;
 * 2. the command, without network: the repository's code never reaches the internet.
 * Both run as an unprivileged user with CPU, memory, process and time limits and a read-only root filesystem.
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

/**
 * Unpacks the repository from `source` into the key's volume, installs when needed and runs `command`. Never throws
 * for what happens inside the containers (that's the report); throws only when Docker itself can't be reached.
 */
export function runInSandbox(input: {
  key: string;
  source: () => Promise<ReadableStream<Uint8Array> | null>;
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

    const created = await docker(["volume", "create", `--label=${LABEL}`, volume]);
    if (created.code !== 0) throw new Error(`The sandbox host refused to create a volume: ${created.output.trim().slice(0, 300)}`);

    const archive = await input.source();
    if (!archive) return done({ exitCode: null, timedOut: false, failedStep: "prepare", output: "Couldn't download the repository from GitHub." });

    const prepareName = containerName(input.key, "prepare");
    const prepare = await docker(
      ["run", "--rm", "-i", `--name=${prepareName}`, ...LIMITS, `--mount=type=volume,src=${volume},dst=${HOME}`, `--workdir=${HOME}`]
        .concat(input.install ? [`--env=TECHTEAM_INSTALL=${input.install}`] : [])
        .concat([image(), "sh", "-c", PREPARE_SCRIPT]),
      { input: capped(archive), timeoutMs: deadline - Date.now(), name: prepareName }
    );
    if (prepare.timedOut || prepare.code !== 0) {
      const unpacked = prepare.output.includes(PREPARED);
      return done({
        exitCode: prepare.code,
        timedOut: prepare.timedOut,
        failedStep: unpacked ? "install" : "prepare",
        output: prepare.output,
      });
    }

    const commandName = containerName(input.key, "command");
    const run = await docker(
      ["run", "--rm", `--name=${commandName}`, ...LIMITS, "--network=none", `--mount=type=volume,src=${volume},dst=${HOME}`, `--workdir=${HOME}/repo`]
        .concat([image(), "sh", "-c", input.command]),
      { timeoutMs: deadline - Date.now(), name: commandName }
    );
    const installLog = prepare.output.split(PREPARED)[1]?.trim() ?? "";
    return done({
      exitCode: run.code,
      timedOut: run.timedOut,
      failedStep: run.timedOut || run.code !== 0 ? "command" : null,
      output: [installLog, `[techteam] $ ${input.command}`, run.output].filter(Boolean).join("\n"),
    });
  });
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
