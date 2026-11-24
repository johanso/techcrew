/**
 * Where the agent sandbox runs, decided from facts the server collects (lib/sandbox/status.ts). Pure and client-safe.
 * `remote`: SANDBOX_DOCKER_HOST names a Docker host prepared by deploy/setup.sh (gVisor, firewall rules, Caddy).
 * `local`: the Docker engine of this computer (Docker Desktop, or Docker on Linux), with the compensations of
 * docs/sandbox.md (install scripts off, no route to the host, no gVisor).
 */

export type SandboxMode = "remote" | "local";

export const UNAVAILABLE_REASONS = ["disabled", "docker-missing", "docker-stopped", "windows-containers", "images-missing"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type SandboxStatus =
  | { state: "ready"; mode: SandboxMode }
  | { state: "unavailable"; reason: UnavailableReason; /** images-missing: which ones. */ missing: string[] };

import { DOCKER_INFO_FORMAT, parseDockerInfo } from "@/lib/sandbox/engine.mjs";

export { DOCKER_INFO_FORMAT, parseDockerInfo };

/** What `docker info` said about the local engine. */
export type EngineProbe = { kind: "missing" } | { kind: "stopped" } | { kind: "engine"; osType: string; version: string };

export function resolveSandboxStatus(input: {
  /** SANDBOX_DOCKER_HOST. */
  host: string | null;
  /** TECHTEAM_SANDBOX=off. */
  disabled: boolean;
  /** The local engine; ignored when `host` is set (a remote host isn't probed from here). */
  engine: EngineProbe;
  /** The images the local mode needs that this engine doesn't have. */
  missingImages: string[];
}): SandboxStatus {
  const unavailable = (reason: UnavailableReason, missing: string[] = []): SandboxStatus => ({ state: "unavailable", reason, missing });
  if (input.disabled) return unavailable("disabled");
  if (input.host) return { state: "ready", mode: "remote" };
  if (input.engine.kind === "missing") return unavailable("docker-missing");
  if (input.engine.kind === "stopped") return unavailable("docker-stopped");
  if (input.engine.osType === "windows") return unavailable("windows-containers");
  if (input.missingImages.length) return unavailable("images-missing", input.missingImages);
  return { state: "ready", mode: "local" };
}

/** Whether TECHTEAM_SANDBOX switches the sandbox off on this computer. */
export const sandboxSwitchedOff = (value: string | undefined) => /^(off|false|0|no)$/i.test(value?.trim() ?? "");

/**
 * Previews need a ready sandbox, and on a remote host also a preview domain (Caddy serves them there). A local
 * sandbox serves them on 127.0.0.1.
 */
export function previewsReady(status: SandboxStatus, domain: string | null) {
  return status.state === "ready" && (status.mode === "local" || domain !== null);
}

/** What Settings says when the sandbox can't run: the problem and what to do about it. */
export function unavailableMessage(status: Extract<SandboxStatus, { state: "unavailable" }>): { problem: string; fix: string } {
  switch (status.reason) {
    case "disabled":
      return { problem: "The sandbox is switched off on this computer.", fix: "Remove TECHTEAM_SANDBOX=off from your environment to use it." };
    case "docker-missing":
      return { problem: "Docker isn't installed on this computer.", fix: "Install Docker Desktop (or Docker Engine on Linux); see docs/setup.md." };
    case "docker-stopped":
      return { problem: "Docker Desktop is not running.", fix: "Start it, then reload this page." };
    case "windows-containers":
      return { problem: "Docker is in Windows-containers mode.", fix: "Switch to Linux containers (Docker Desktop's tray menu), then reload this page." };
    case "images-missing":
      return { problem: "The sandbox images are missing.", fix: "Run `npm run sandbox:setup` in the TechTeam folder." };
  }
}

/** One line for the server log and for errors returned by actions. */
export function unavailableSentence(status: Extract<SandboxStatus, { state: "unavailable" }>) {
  const { problem, fix } = unavailableMessage(status);
  return `${problem} ${fix}`;
}

/** Why link captures can't run: their safety rests on the firewall rules of a prepared remote host. */
export const LINK_CAPTURE_LOCAL_REASON = "Links are captured on a sandbox host prepared with deploy/setup.sh (SANDBOX_DOCKER_HOST). The Docker on this computer can't do it safely.";
