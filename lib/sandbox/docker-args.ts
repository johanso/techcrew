/**
 * Every argument list the sandbox hands to `docker`, built here and nowhere else, so one test can check them all
 * (docker-args.test.ts: no --privileged, no Docker socket, no host path, no host network, no added capability, no
 * device, no user but the unprivileged one). Pure; lib/sandbox/docker.ts and browser.ts only spawn what these return.
 *
 * `remote` is the VPS prepared by deploy/setup.sh and keeps its arguments exactly (gVisor, the fixed install subnet,
 * public resolvers, Caddy's labels). `local` is the owner's own Docker: the default runtime (on Docker Desktop the
 * containers live inside its Linux VM), no resolv.conf volume, no subnet, no Caddy, and the host's usual names pinned
 * to loopback so a container can't use them to reach the computer.
 */

import { localInstallCommand } from "@/lib/sandbox/install-command";
import type { SandboxMode } from "@/lib/sandbox/mode";

export const SANDBOX_LABEL = "techteam.sandbox=1";
export const SANDBOX_HOME = "/home/node";
/** A preview forwarder is named after its preview container plus this suffix. */
export const FORWARDER_SUFFIX = "-fwd";

/** The names Docker Desktop (and `host-gateway` setups) give the host: pinned to loopback inside every local container. */
const HOST_ALIASES = ["host.docker.internal", "gateway.docker.internal"];
// Both address families: with only an IPv4 entry, `getent hosts` still got the engine's IPv6 address for the host from DNS.
const hostAliasFlags = (mode: SandboxMode) => (mode === "local" ? HOST_ALIASES.flatMap((name) => [`--add-host=${name}:127.0.0.1`, `--add-host=${name}:::1`]) : []);

/** Flags every sandbox container carries (the command, install, preview and read-back containers). */
export function sandboxLimits(mode: SandboxMode): string[] {
  return [
    ...(mode === "remote" ? ["--runtime=runsc"] : []),
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
    `--label=${SANDBOX_LABEL}`,
    // Local images come from `npm run sandbox:setup`; a container start never reaches for a registry.
    mode === "remote" ? "--pull=missing" : "--pull=never",
    ...hostAliasFlags(mode),
  ];
}

/** The Tester's browser and link captures (capture.ts, remote only). The tag is built from deploy/browser, never pulled. */
export function browserLimits(mode: SandboxMode): string[] {
  return [
    ...(mode === "remote" ? ["--runtime=runsc"] : []),
    "--cpus=1",
    "--memory=1536m",
    "--memory-swap=1536m",
    "--pids-limit=256",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
    "--user=pwuser",
    `--label=${SANDBOX_LABEL}`,
    "--label=techteam.browser=1",
    "--pull=never",
    ...hostAliasFlags(mode),
  ];
}

/** The small container that publishes a local preview on loopback (it only pipes bytes). */
function forwarderLimits(): string[] {
  return [
    "--cpus=0.5",
    "--memory=128m",
    "--memory-swap=128m",
    "--pids-limit=64",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--user=node",
    `--label=${SANDBOX_LABEL}`,
    "--pull=never",
    ...hostAliasFlags("local"),
  ];
}

const volumeMount = (volume: string) => `--mount=type=volume,src=${volume},dst=${SANDBOX_HOME}`;

export function volumeCreateArgs(volume: string, labels: string[] = []) {
  return ["volume", "create", `--label=${SANDBOX_LABEL}`, ...labels, volume];
}

// ── Networks ───────────────────────────────────────────────────────────────────

/**
 * A bridge network with internet and no traffic between containers. Remote: a fixed subnet the host firewall knows.
 * Local: whatever subnet Docker picks (nothing here can firewall the computer's LAN: the install step's guard there is
 * --ignore-scripts, see install-command.ts).
 */
export function bridgeNetworkCreateArgs(mode: SandboxMode, network: { name: string; subnet: string; label: string }) {
  return [
    "network",
    "create",
    ...(mode === "remote" ? [`--subnet=${network.subnet}`] : []),
    "--opt=com.docker.network.bridge.enable_icc=false",
    `--label=${network.label}`,
    network.name,
  ];
}

/** A preview's network: internal, so nothing in it has a route out. */
export function previewNetworkCreateArgs(network: string, labels: string[]) {
  return ["network", "create", "--internal", ...labels, network];
}

// ── The install step (remote's public resolvers) ─────────────────────────────

export function dnsVolumeCreateArgs(volume: string) {
  return ["volume", "create", "--label=techteam.install-network=1", volume];
}

/** Remote only: writes the resolv.conf the install step mounts. Root writes into the volume; no network, no capabilities. */
export function dnsWriterArgs(input: { volume: string; image: string }) {
  return [
    "run",
    "--rm",
    "-i",
    ...sandboxLimits("remote").filter((flag) => flag !== "--user=node"),
    "--user=root",
    "--network=none",
    `--mount=type=volume,src=${input.volume},dst=/dns`,
    input.image,
    "sh",
    "-c",
    "cat > /dns/resolv.conf.new && chmod 644 /dns/resolv.conf.new && mv /dns/resolv.conf.new /dns/resolv.conf",
  ];
}

// ── Sandbox containers ─────────────────────────────────────────────────────────

/** The network flags of the prepare container: the install network (remote: with public resolvers mounted over resolv.conf). */
export function installNetworkFlags(mode: SandboxMode, network: string, dnsVolume: string) {
  return mode === "remote"
    ? [`--network=${network}`, `--mount=type=volume,src=${dnsVolume},dst=/etc/resolv.conf,volume-subpath=resolv.conf,readonly`]
    : [`--network=${network}`];
}

/** The environment that turns package managers' install scripts off (local mode, unless the owner allowed them). */
export const INSTALL_SCRIPTS_OFF_ENV = ["--env=npm_config_ignore_scripts=true", "--env=YARN_IGNORE_SCRIPTS=true"] as const;

/** Unpack the tarball from stdin over the last checkout and install: the one container with network. */
export function prepareArgs(input: {
  mode: SandboxMode;
  name: string;
  volume: string;
  image: string;
  install: string | null;
  /** Local only: the owner allowed install scripts (Settings → Sandbox). */
  allowScripts: boolean;
  network: string;
  dnsVolume: string;
  script: string;
}) {
  const install = input.install === null ? null : input.mode === "local" ? localInstallCommand(input.install, input.allowScripts) : input.install;
  return [
    "run",
    "--rm",
    "-i",
    `--name=${input.name}`,
    ...sandboxLimits(input.mode),
    ...installNetworkFlags(input.mode, input.network, input.dnsVolume),
    volumeMount(input.volume),
    `--workdir=${SANDBOX_HOME}`,
    ...(install ? [`--env=TECHTEAM_INSTALL=${install}`] : []),
    // Defense in depth for local mode: whatever shape the install command has (a quoted `sh -c`, a wrapper), npm and
    // pnpm (npm_config_*) and yarn classic honor these, so scripts stay off without parsing the command.
    ...(input.mode === "local" && !input.allowScripts ? [...INSTALL_SCRIPTS_OFF_ENV] : []),
    input.image,
    "sh",
    "-c",
    input.script,
  ];
}

/** The command step: no network at all. */
export function commandArgs(input: { mode: SandboxMode; name: string; volume: string; image: string; command: string }) {
  return [
    "run",
    "--rm",
    `--name=${input.name}`,
    ...sandboxLimits(input.mode),
    "--network=none",
    volumeMount(input.volume),
    `--workdir=${SANDBOX_HOME}/repo`,
    input.image,
    "sh",
    "-c",
    input.command,
  ];
}

/** add_dependency's read-back: prints files from the volume, no network. */
export function readFilesArgs(input: { mode: SandboxMode; name: string; volume: string; image: string; script: string; maxFileBytes: number; files: string[] }) {
  return [
    "run",
    "--rm",
    `--name=${input.name}`,
    ...sandboxLimits(input.mode),
    "--network=none",
    volumeMount(input.volume),
    `--workdir=${SANDBOX_HOME}/repo`,
    input.image,
    "node",
    "-e",
    input.script,
    String(input.maxFileBytes),
    ...input.files,
  ];
}

// ── Previews ───────────────────────────────────────────────────────────────────

/**
 * The preview's container: on its internal network alone, serving `command` on `port`. Remote: Caddy picks it up by
 * its labels and serves `host` over HTTPS. Local: nothing outside reaches it except the forwarder.
 */
export function previewStartArgs(input: {
  mode: SandboxMode;
  container: string;
  network: string;
  volume: string;
  image: string;
  command: string;
  host: string;
  port: number;
  labels: string[];
}) {
  const allowedHosts = input.mode === "remote" ? `${input.container},${input.host}` : `${input.container},localhost,127.0.0.1`;
  return [
    "run",
    "--detach",
    `--name=${input.container}`,
    ...sandboxLimits(input.mode),
    ...input.labels,
    `--network=${input.network}`,
    volumeMount(input.volume),
    `--workdir=${SANDBOX_HOME}/repo`,
    `--env=PORT=${input.port}`,
    "--env=HOST=0.0.0.0",
    // Vite answers only hosts it knows (DNS rebinding protection).
    `--env=__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${allowedHosts}`,
    ...(input.mode === "remote"
      ? [`--label=caddy=${input.host}`, `--label=caddy.reverse_proxy={{upstreams ${input.port}}}`, `--label=caddy_ingress_network=${input.network}`]
      : []),
    input.image,
    "sh",
    "-c",
    input.command,
  ];
}

/** Our own 20 lines: pipes loopback-published TCP to the preview's address on its internal network. */
export const FORWARD_SCRIPT = `const net = require("net");
const [host, port] = process.argv.slice(1);
net.createServer((client) => {
  const upstream = net.connect(Number(port), host);
  const end = () => { client.destroy(); upstream.destroy(); };
  client.on("error", end); upstream.on("error", end); client.on("close", end); upstream.on("close", end);
  client.pipe(upstream); upstream.pipe(client);
}).listen(Number(port), "0.0.0.0");`;

/**
 * Local previews: Docker can't publish the ports of a container on an internal network, so this container is created
 * on the default bridge with its port published on 127.0.0.1 only (a random host port), then joined to the preview's
 * internal network (forwarderConnectArgs) and started. The preview itself never gets a route out.
 */
export function forwarderCreateArgs(input: { name: string; image: string; labels: string[]; targetAddress: string; port: number }) {
  return [
    "create",
    `--name=${input.name}`,
    ...forwarderLimits(),
    ...input.labels,
    "--network=bridge",
    `--publish=127.0.0.1::${input.port}`,
    input.image,
    "node",
    "-e",
    FORWARD_SCRIPT,
    input.targetAddress,
    String(input.port),
  ];
}

export const forwarderConnectArgs = (network: string, forwarder: string) => ["network", "connect", network, forwarder];
export const forwarderStartArgs = (forwarder: string) => ["start", forwarder];
export const forwarderPortArgs = (forwarder: string, port: number) => ["port", forwarder, `${port}/tcp`];

/** `docker port` → the host port a forwarder is published on (`127.0.0.1:49153`), else null. */
export function parsePublishedPort(output: string): number | null {
  for (const line of output.split("\n")) {
    const match = /^(?:127\.0\.0\.1):(\d{2,5})$/.exec(line.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

// ── Browser ────────────────────────────────────────────────────────────────────

/** The Tester's browser: one container on the preview's internal network, with the preview's address by --add-host. */
export function browserRunArgs(input: { mode: SandboxMode; name: string; network: string; container: string; address: string; image: string }) {
  return [
    "run",
    "--rm",
    "-i",
    `--name=${input.name}`,
    ...browserLimits(input.mode),
    `--network=${input.network}`,
    // Docker's DNS doesn't answer under gVisor: give the browser the preview's address, and nothing else.
    `--add-host=${input.container}:${input.address}`,
    // Chromium's own sandbox can't start under the default runtime with every capability dropped (seccomp refuses its
    // namespaces), and relaxing seccomp would be worse: locally the container is the boundary (docs/sandbox.md).
    ...(input.mode === "local" ? ["--env=TECHTEAM_CHROMIUM_NO_SANDBOX=1"] : []),
    input.image,
  ];
}

/** Link captures (remote only: their safety rests on the host firewall): a browser with internet on its own bridge. */
export function captureRunArgs(input: { name: string; network: string; image: string; limits: string[] }) {
  return ["run", "--rm", "-i", `--name=${input.name}`, ...input.limits, "--label=techteam.capture=1", `--network=${input.network}`, input.image];
}
