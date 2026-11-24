// The decisions of `npm run sandbox:setup` (scripts/sandbox-setup.mjs): what it does for a given machine, with no I/O.
// Plain node so the script runs without a build; unit-tested.

/**
 * @param {string[]} argv
 * @returns {{ check: boolean, remote: boolean, help: boolean, unknown: string[] }}
 */
export function parseSetupArgs(argv) {
  const flags = new Set(argv);
  const known = new Set(["--check", "--remote", "--help", "-h"]);
  return {
    check: flags.has("--check"),
    remote: flags.has("--remote"),
    help: flags.has("--help") || flags.has("-h"),
    unknown: argv.filter((arg) => !known.has(arg)),
  };
}

/**
 * @typedef {{ kind: "missing" } | { kind: "stopped" } | { kind: "engine", osType: string, version: string }} Engine
 * @typedef {{ id: "sandbox-image" | "browser-image", image: string, action: "pull" | "build" | "have" }} Step
 */

/**
 * What the setup does. `refusal` is set when it can't (or shouldn't) run at all; `steps` says, per image, whether it is
 * downloaded or built now or already there. `--check` only reports the steps.
 * @param {{ remoteHost: string | null, remoteFlag: boolean, engine: Engine, present: { sandbox: boolean, browser: boolean }, images: { sandbox: string, browser: string } }} input
 * @returns {{ refusal: string | null, steps: Step[] }}
 */
export function setupPlan(input) {
  /** @type {(refusal: string) => { refusal: string, steps: Step[] }} */
  const refuse = (refusal) => ({ refusal, steps: [] });
  if (input.remoteHost && !input.remoteFlag) {
    return refuse("SANDBOX_DOCKER_HOST is set: the sandbox runs on that host, which deploy/setup.sh prepares. Use --remote to prepare its images from here anyway.");
  }
  if (input.engine.kind === "missing") return refuse("Docker isn't installed. Install Docker Desktop (or Docker Engine on Linux), start it and run this again.");
  if (input.engine.kind === "stopped") return refuse("Docker isn't running. Start Docker Desktop (or the Docker service) and run this again.");
  if (input.engine.osType === "windows") return refuse("Docker is in Windows-containers mode. Switch to Linux containers (Docker Desktop's tray menu) and run this again.");
  return {
    refusal: null,
    steps: [
      { id: "sandbox-image", image: input.images.sandbox, action: input.present.sandbox ? "have" : "pull" },
      { id: "browser-image", image: input.images.browser, action: input.present.browser ? "have" : "build" },
    ],
  };
}

/** @param {number} bytes */
export function formatImageSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** @param {Step} step */
export function describeStep(step) {
  const what = step.id === "sandbox-image" ? "Sandbox image" : "Browser image";
  const how = step.action === "have" ? "already there" : step.action === "pull" ? "will be downloaded" : "will be built from deploy/browser";
  return `${what} ${step.image}: ${how}`;
}
