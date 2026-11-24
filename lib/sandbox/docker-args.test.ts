import { describe, expect, it } from "vitest";

import { SANDBOX_DNS_VOLUME, SANDBOX_NETWORK, SANDBOX_SUBNET } from "@/lib/sandbox/config";
import {
  FORWARD_SCRIPT,
  INSTALL_SCRIPTS_OFF_ENV,
  browserLimits,
  browserRunArgs,
  bridgeNetworkCreateArgs,
  captureRunArgs,
  commandArgs,
  dnsVolumeCreateArgs,
  dnsWriterArgs,
  forwarderConnectArgs,
  forwarderCreateArgs,
  forwarderPortArgs,
  forwarderStartArgs,
  installNetworkFlags,
  parsePublishedPort,
  prepareArgs,
  previewNetworkCreateArgs,
  previewStartArgs,
  readFilesArgs,
  sandboxLimits,
  volumeCreateArgs,
} from "@/lib/sandbox/docker-args";
import type { SandboxMode } from "@/lib/sandbox/mode";

const IMAGE = "node:24-bookworm";
const BROWSER = "techteam-browser:1.64.1-3";
const MODES: SandboxMode[] = ["remote", "local"];

type Built = { name: string; mode: SandboxMode | "both"; args: string[]; /** Containers the repository's code or a browser runs in. */ container: boolean };

/** Every argument list the module can produce, in every mode and with the optional parts on and off. */
function everyArgumentList(): Built[] {
  const lists: Built[] = [];
  for (const mode of MODES) {
    for (const install of [null, "npm ci"]) {
      for (const allowScripts of [false, true]) {
        lists.push({
          name: `prepare ${mode} install=${install} scripts=${allowScripts}`,
          mode,
          container: true,
          args: prepareArgs({ mode, name: "techteam-run-1-prepare-ab12", volume: "techteam-run-1", image: IMAGE, install, allowScripts, network: SANDBOX_NETWORK, dnsVolume: SANDBOX_DNS_VOLUME, script: "echo hi" }),
        });
      }
    }
    lists.push({ name: `command ${mode}`, mode, container: true, args: commandArgs({ mode, name: "c", volume: "techteam-run-1", image: IMAGE, command: "npm test" }) });
    lists.push({ name: `read ${mode}`, mode, container: true, args: readFilesArgs({ mode, name: "r", volume: "techteam-run-1", image: IMAGE, script: "x", maxFileBytes: 1000, files: ["package.json"] }) });
    lists.push({
      name: `preview ${mode}`,
      mode,
      container: true,
      args: previewStartArgs({
        mode,
        container: "techteam-preview-run-1",
        network: "techteam-preview-run-1",
        volume: "techteam-preview-run-1",
        image: IMAGE,
        command: "npm start",
        host: "pr-1-abc123.preview.example.com",
        port: 4173,
        labels: ["--label=techteam.preview=1", "--label=techteam.preview.run=1"],
      }),
    });
    lists.push({
      name: `browser ${mode}`,
      mode,
      container: true,
      args: browserRunArgs({ mode, name: "b", network: "techteam-preview-run-1", container: "techteam-preview-run-1", address: "172.18.0.2", image: BROWSER }),
    });
    lists.push({ name: `network ${mode}`, mode, container: false, args: bridgeNetworkCreateArgs(mode, { name: SANDBOX_NETWORK, subnet: SANDBOX_SUBNET, label: "techteam.install-network=1" }) });
    lists.push({ name: `install network flags ${mode}`, mode, container: false, args: installNetworkFlags(mode, SANDBOX_NETWORK, SANDBOX_DNS_VOLUME) });
    lists.push({ name: `limits ${mode}`, mode, container: false, args: sandboxLimits(mode) });
    lists.push({ name: `browser limits ${mode}`, mode, container: false, args: browserLimits(mode) });
  }
  lists.push({
    name: "forwarder local",
    mode: "local",
    container: true,
    args: forwarderCreateArgs({ name: "techteam-preview-run-1-fwd", image: IMAGE, labels: ["--label=techteam.preview=1"], targetAddress: "172.18.0.2", port: 4173 }),
  });
  lists.push({ name: "dns writer remote", mode: "remote", container: true, args: dnsWriterArgs({ volume: SANDBOX_DNS_VOLUME, image: IMAGE }) });
  lists.push({
    name: "capture remote",
    mode: "remote",
    container: true,
    args: captureRunArgs({ name: "cap", network: "techteam-capture", image: BROWSER, limits: browserLimits("remote") }),
  });
  lists.push({ name: "preview network", mode: "both", container: false, args: previewNetworkCreateArgs("techteam-preview-run-1", ["--label=techteam.preview=1"]) });
  lists.push({ name: "volume", mode: "both", container: false, args: volumeCreateArgs("techteam-run-1", ["--label=x=1"]) });
  lists.push({ name: "dns volume", mode: "both", container: false, args: dnsVolumeCreateArgs(SANDBOX_DNS_VOLUME) });
  lists.push({ name: "forwarder connect", mode: "local", container: false, args: forwarderConnectArgs("techteam-preview-run-1", "techteam-preview-run-1-fwd") });
  lists.push({ name: "forwarder start", mode: "local", container: false, args: forwarderStartArgs("techteam-preview-run-1-fwd") });
  lists.push({ name: "forwarder port", mode: "local", container: false, args: forwarderPortArgs("techteam-preview-run-1-fwd", 4173) });
  return lists;
}

const ALLOWED_ENV = /^--env=(CI=true|TECHTEAM_INSTALL=.+|PORT=\d+|HOST=0\.0\.0\.0|__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=[a-z0-9.,-]+|npm_config_ignore_scripts=true|YARN_IGNORE_SCRIPTS=true)$/;
const HARMLESS_ENV_NAMES = ["TECHTEAM_INSTALL", "CI", "PORT", "HOST", "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "npm_config_ignore_scripts", "YARN_IGNORE_SCRIPTS"];
const HOST_ALIASES = ["--add-host=host.docker.internal:127.0.0.1", "--add-host=gateway.docker.internal:127.0.0.1"];

describe("every docker argument list", () => {
  const lists = everyArgumentList();

  it("covers the lists of both modes", () => {
    expect(lists.length).toBeGreaterThan(30);
    for (const mode of MODES) expect(lists.filter((list) => list.mode === mode && list.container).length).toBeGreaterThan(5);
  });

  describe.each(lists)("$name", ({ args, container, mode }) => {
    it("never asks for more privilege than the sandbox grants", () => {
      const forbidden = [/^--privileged/, /^--network=host$/, /^--net=host$/, /^--net(work)?[= ]host/, /^--pid=/, /^--ipc=/, /^--uts=/, /^--userns=/, /^--cap-add/, /^--device/, /^-v$/, /^--volume/, /^--volumes-from/, /^-p$/, /^--cgroupns/, /^--sysctl/, /^--ulimit/, /^--group-add/, /^--add-host=host-gateway/];
      for (const arg of args) for (const pattern of forbidden) expect(arg, `${arg} matches ${pattern}`).not.toMatch(pattern);
      for (const arg of args) {
        expect(arg).not.toContain("docker.sock");
        expect(arg).not.toContain("/var/run");
        expect(arg).not.toMatch(/^--security-opt=(?!no-new-privileges$)/);
        expect(arg).not.toMatch(/^--security-opt$/);
      }
    });

    it("mounts only named volumes, never a host path", () => {
      for (const arg of args.filter((a) => a.startsWith("--mount"))) {
        const fields = Object.fromEntries(arg.slice("--mount=".length).split(",").map((field) => field.split("=") as [string, string | undefined]));
        expect(fields.type).toBe("volume");
        expect(fields.src).toMatch(/^techteam-[a-z0-9-]+$/);
        expect(fields.dst).toMatch(/^\//);
        expect(Object.keys(fields).every((key) => ["type", "src", "dst", "volume-subpath", "readonly"].includes(key))).toBe(true);
      }
      expect(args.filter((a) => a.startsWith("--tmpfs")).every((a) => a.startsWith("--tmpfs=/tmp:"))).toBe(true);
      // No bind-looking source anywhere: an absolute host path, a relative one or a drive letter next to a colon.
      expect(args.filter((a) => /^(\.{1,2}\/|[A-Za-z]:[\\/]|\/(home|Users|mnt|c|etc|root)\b)/.test(a) && !a.startsWith("/home/node"))).toEqual([]);
    });

    it("puts only harmless values in the container's environment", () => {
      for (const arg of args.filter((a) => a.startsWith("--env"))) expect(arg).toMatch(ALLOWED_ENV);
      for (const arg of args.filter((a) => a.startsWith("--env"))) expect(arg.split("=")[1]).not.toMatch(/KEY|TOKEN|SECRET|PASSWORD|DATABASE/i);
      expect(args).not.toContain("--env-file");
    });

    it("publishes ports on loopback only", () => {
      for (const arg of args.filter((a) => a.startsWith("--publish") || a === "-P" || a === "--publish-all")) expect(arg).toMatch(/^--publish=127\.0\.0\.1::\d+$/);
    });

    it("runs as an unprivileged user with the hardening flags (containers)", () => {
      if (!container) return;
      const users = args.filter((a) => a.startsWith("--user="));
      expect(users).toHaveLength(1);
      // The one root container writes resolv.conf into a volume, with no network and no capabilities (remote only).
      if (users[0] === "--user=root") {
        expect(args).toContain("--network=none");
        expect(args).toContain("--mount=type=volume,src=techteam-sandbox-dns,dst=/dns");
        expect(mode).toBe("remote");
      } else {
        expect(users[0]).toMatch(/^--user=(node|pwuser)$/);
      }
      for (const required of ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only"]) expect(args).toContain(required);
      for (const prefix of ["--cpus=", "--memory=", "--memory-swap=", "--pids-limit="]) expect(args.some((a) => a.startsWith(prefix))).toBe(true);
      expect(args.some((a) => a.startsWith("--label=techteam."))).toBe(true);
    });

    it("has gVisor on a remote host and only there", () => {
      if (!container) return;
      if (mode === "remote") expect(args).toContain("--runtime=runsc");
      if (mode === "local") expect(args.some((a) => a.startsWith("--runtime"))).toBe(false);
    });

    it("pins the host's usual names to loopback in local mode", () => {
      if (!container || mode !== "local") return;
      for (const alias of HOST_ALIASES) expect(args).toContain(alias);
    });
  });

  it("sets only the listed harmless environment names, across the whole set the module can produce", () => {
    const flags = new Set(lists.flatMap((list) => list.args.filter((arg) => arg.startsWith("--env="))));
    const names = new Set([...flags].map((flag) => flag.slice("--env=".length).split("=")[0]));
    expect([...names].every((name) => HARMLESS_ENV_NAMES.includes(name!))).toBe(true);
    // A secret's name or value never appears, except inside the owner's own install command text.
    for (const flag of [...flags].filter((f) => !f.startsWith("--env=TECHTEAM_INSTALL="))) expect(flag).not.toMatch(/TOKEN|SECRET|KEY|PASSWORD/i);
  });

  it("gives every local list the same flags as the remote one, minus gVisor, plus the host aliases", () => {
    const strip = (flags: string[]) => flags.filter((flag) => flag !== "--runtime=runsc" && !HOST_ALIASES.includes(flag) && !flag.startsWith("--pull="));
    expect(strip(sandboxLimits("local"))).toEqual(strip(sandboxLimits("remote")));
    expect(strip(browserLimits("local"))).toEqual(strip(browserLimits("remote")));
    expect(sandboxLimits("local")).not.toContain("--runtime=runsc");
  });
});

describe("remote mode keeps its arguments exactly", () => {
  it("sandbox limits are the ones deploy/setup.sh's hosts were built for", () => {
    expect(sandboxLimits("remote")).toEqual([
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
      "--label=techteam.sandbox=1",
      "--pull=missing",
    ]);
    expect(browserLimits("remote")).toEqual([
      "--runtime=runsc",
      "--cpus=1",
      "--memory=1536m",
      "--memory-swap=1536m",
      "--pids-limit=256",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--read-only",
      "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
      "--user=pwuser",
      "--label=techteam.sandbox=1",
      "--label=techteam.browser=1",
      "--pull=never",
    ]);
  });

  it("the install step uses the fixed subnet, public resolvers and an empty network for the command", () => {
    expect(bridgeNetworkCreateArgs("remote", { name: SANDBOX_NETWORK, subnet: SANDBOX_SUBNET, label: "techteam.install-network=1" })).toEqual([
      "network",
      "create",
      `--subnet=${SANDBOX_SUBNET}`,
      "--opt=com.docker.network.bridge.enable_icc=false",
      "--label=techteam.install-network=1",
      SANDBOX_NETWORK,
    ]);
    expect(installNetworkFlags("remote", SANDBOX_NETWORK, SANDBOX_DNS_VOLUME)).toEqual([
      `--network=${SANDBOX_NETWORK}`,
      `--mount=type=volume,src=${SANDBOX_DNS_VOLUME},dst=/etc/resolv.conf,volume-subpath=resolv.conf,readonly`,
    ]);
    const prepare = prepareArgs({ mode: "remote", name: "p", volume: "v", image: IMAGE, install: "npm ci", allowScripts: false, network: SANDBOX_NETWORK, dnsVolume: SANDBOX_DNS_VOLUME, script: "s" });
    expect(prepare).toContain("--env=TECHTEAM_INSTALL=npm ci");
  });

  it("previews are served by Caddy from their labels", () => {
    const args = previewStartArgs({ mode: "remote", container: "c", network: "n", volume: "v", image: IMAGE, command: "npm start", host: "pr-1-abc123.preview.example.com", port: 4173, labels: [] });
    expect(args).toContain("--label=caddy=pr-1-abc123.preview.example.com");
    expect(args).toContain("--label=caddy.reverse_proxy={{upstreams 4173}}");
    expect(args).toContain("--label=caddy_ingress_network=n");
    expect(args).toContain("--env=__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=c,pr-1-abc123.preview.example.com");
  });
});

describe("local mode", () => {
  it("runs the command step without a network, as remote does", () => {
    for (const mode of MODES) {
      expect(commandArgs({ mode, name: "c", volume: "v", image: IMAGE, command: "x" })).toContain("--network=none");
      expect(readFilesArgs({ mode, name: "c", volume: "v", image: IMAGE, script: "s", maxFileBytes: 1, files: [] })).toContain("--network=none");
    }
  });

  it("creates the install network without a fixed subnet and with icc off", () => {
    const args = bridgeNetworkCreateArgs("local", { name: SANDBOX_NETWORK, subnet: SANDBOX_SUBNET, label: "techteam.install-network=1" });
    expect(args.some((a) => a.startsWith("--subnet"))).toBe(false);
    expect(args).toContain("--opt=com.docker.network.bridge.enable_icc=false");
    expect(args).not.toContain("--internal");
    expect(installNetworkFlags("local", SANDBOX_NETWORK, SANDBOX_DNS_VOLUME)).toEqual([`--network=${SANDBOX_NETWORK}`]);
  });

  it("never pulls an image when a container starts", () => {
    expect(sandboxLimits("local")).toContain("--pull=never");
    expect(browserLimits("local")).toContain("--pull=never");
  });

  it("runs the install without scripts unless the owner allowed them", () => {
    const install = (allowScripts: boolean) =>
      prepareArgs({ mode: "local", name: "p", volume: "v", image: IMAGE, install: "npm ci && npm run build", allowScripts, network: SANDBOX_NETWORK, dnsVolume: SANDBOX_DNS_VOLUME, script: "s" });
    expect(install(false)).toContain("--env=TECHTEAM_INSTALL=npm ci --ignore-scripts && npm run build");
    expect(install(true)).toContain("--env=TECHTEAM_INSTALL=npm ci && npm run build");
  });

  it("sets the scripts-off environment in local mode unless scripts are allowed, whatever the command's shape", () => {
    const flags = (mode: "local" | "remote", allowScripts: boolean, install = 'sh -c "npm ci"') =>
      prepareArgs({ mode, name: "p", volume: "v", image: IMAGE, install, allowScripts, network: SANDBOX_NETWORK, dnsVolume: SANDBOX_DNS_VOLUME, script: "s" });
    for (const install of ['sh -c "npm ci"', "npm ci", "make deps", null]) {
      expect(flags("local", false, install as string)).toEqual(expect.arrayContaining([...INSTALL_SCRIPTS_OFF_ENV]));
      for (const off of INSTALL_SCRIPTS_OFF_ENV) {
        expect(flags("local", true, install as string)).not.toContain(off);
        expect(flags("remote", false, install as string)).not.toContain(off);
        expect(flags("remote", true, install as string)).not.toContain(off);
      }
    }
  });

  it("leaves a remote install command exactly as written, scripts or not", () => {
    for (const allowScripts of [false, true]) {
      const args = prepareArgs({ mode: "remote", name: "p", volume: "v", image: IMAGE, install: "npm ci", allowScripts, network: SANDBOX_NETWORK, dnsVolume: SANDBOX_DNS_VOLUME, script: "s" });
      expect(args).toContain("--env=TECHTEAM_INSTALL=npm ci");
    }
  });

  it("serves a preview with no Caddy labels and the loopback hosts allowed", () => {
    const args = previewStartArgs({ mode: "local", container: "techteam-preview-run-7", network: "n", volume: "v", image: IMAGE, command: "npm start", host: "pr-7-abc123.preview.localhost", port: 4173, labels: [] });
    expect(args.some((a) => a.includes("caddy"))).toBe(false);
    expect(args).toContain("--env=__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=techteam-preview-run-7,localhost,127.0.0.1");
    expect(args).toContain("--network=n");
  });

  it("creates the forwarder on the default bridge, published on loopback only, then joins it to the internal network", () => {
    const args = forwarderCreateArgs({ name: "f", image: IMAGE, labels: ["--label=techteam.preview=1"], targetAddress: "172.18.0.2", port: 4173 });
    expect(args.slice(0, 2)).toEqual(["create", "--name=f"]);
    expect(args).toContain("--network=bridge");
    expect(args).toContain("--publish=127.0.0.1::4173");
    expect(args.slice(-5)).toEqual(["node", "-e", FORWARD_SCRIPT, "172.18.0.2", "4173"]);
    expect(forwarderConnectArgs("net", "f")).toEqual(["network", "connect", "net", "f"]);
    expect(forwarderPortArgs("f", 4173)).toEqual(["port", "f", "4173/tcp"]);
  });

  it("runs the browser on the preview's network with its address, nothing else", () => {
    const args = browserRunArgs({ mode: "local", name: "b", network: "n", container: "techteam-preview-run-7", address: "172.18.0.2", image: BROWSER });
    expect(args).toContain("--network=n");
    expect(args).toContain("--add-host=techteam-preview-run-7:172.18.0.2");
    expect(args[args.length - 1]).toBe(BROWSER);
  });

  it("makes the preview network internal in both modes", () => {
    expect(previewNetworkCreateArgs("n", ["--label=a=1"])).toEqual(["network", "create", "--internal", "--label=a=1", "n"]);
  });
});

describe("parsePublishedPort", () => {
  it("reads docker port's answer", () => {
    expect(parsePublishedPort("127.0.0.1:49153\n")).toBe(49153);
    expect(parsePublishedPort("127.0.0.1:32768\r\n")).toBe(32768);
  });

  it("refuses anything that isn't loopback", () => {
    expect(parsePublishedPort("0.0.0.0:49153")).toBeNull();
    expect(parsePublishedPort("[::]:49153")).toBeNull();
    expect(parsePublishedPort("192.168.1.5:49153")).toBeNull();
    expect(parsePublishedPort("")).toBeNull();
    expect(parsePublishedPort("Error: No such container")).toBeNull();
  });

  it("takes the loopback line when there are several", () => {
    expect(parsePublishedPort("0.0.0.0:1111\n127.0.0.1:2222\n")).toBe(2222);
  });
});
