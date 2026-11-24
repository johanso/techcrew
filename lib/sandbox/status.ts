import "server-only";

import { browserImage, dockerCli, sandboxHost, sandboxImage } from "@/lib/sandbox/cli";
import {
  DOCKER_INFO_FORMAT,
  parseDockerInfo,
  previewsReady,
  resolveSandboxStatus,
  sandboxSwitchedOff,
  type EngineProbe,
  type SandboxStatus,
} from "@/lib/sandbox/mode";

/**
 * Whether the sandbox can run on this computer right now (lib/sandbox/mode.ts decides, this collects the facts): the
 * remote host is only read from SANDBOX_DOCKER_HOST; the local engine is asked with `docker info` (5 s limit) and the
 * images with `docker image inspect`. The answer is cached for STATUS_TTL_MS and shared by concurrent callers, so
 * Settings, the pipeline and the sweeps never run it more often than that. Never throws.
 */

const PROBE_TIMEOUT_MS = 5_000;
const STATUS_TTL_MS = 15_000;

async function probeEngine(): Promise<EngineProbe> {
  try {
    const run = await dockerCli(["info", `--format=${DOCKER_INFO_FORMAT}`], { timeoutMs: PROBE_TIMEOUT_MS });
    return parseDockerInfo({ code: run.code, stdout: run.stdout, timedOut: run.timedOut });
  } catch (error) {
    return parseDockerInfo({ code: null, stdout: "", errorCode: (error as NodeJS.ErrnoException).code ?? null });
  }
}

async function missingImages(): Promise<string[]> {
  const images = [sandboxImage(), browserImage()];
  const present = await Promise.all(
    images.map((image) => dockerCli(["image", "inspect", "--format={{.Id}}", image], { timeoutMs: PROBE_TIMEOUT_MS }).then((run) => run.code === 0, () => false))
  );
  return images.filter((_image, index) => !present[index]);
}

async function collect(): Promise<SandboxStatus> {
  const host = sandboxHost();
  const disabled = sandboxSwitchedOff(process.env.TECHTEAM_SANDBOX);
  if (host || disabled) return resolveSandboxStatus({ host, disabled, engine: { kind: "stopped" }, missingImages: [] });
  const engine = await probeEngine();
  const images = engine.kind === "engine" && engine.osType !== "windows" ? await missingImages() : [];
  return resolveSandboxStatus({ host, disabled, engine, missingImages: images });
}

let cached: { at: number; status: Promise<SandboxStatus> } | null = null;

/** The sandbox's status, at most STATUS_TTL_MS old. */
export function getSandboxStatus(): Promise<SandboxStatus> {
  if (!cached || Date.now() - cached.at > STATUS_TTL_MS) {
    const status = collect().catch((): SandboxStatus => ({ state: "unavailable", reason: "docker-stopped", missing: [] }));
    cached = { at: Date.now(), status };
  }
  return cached.status;
}

/** Previews can be served: a ready sandbox, and on a remote host a SANDBOX_PREVIEW_DOMAIN (lib/sandbox/preview.ts). */
export async function previewsSupported(domain: string | null) {
  return previewsReady(await getSandboxStatus(), domain);
}
