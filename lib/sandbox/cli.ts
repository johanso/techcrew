import "server-only";

import { spawn } from "node:child_process";

import { dockerCliEnv } from "@/lib/sandbox/docker-env";
import { browserImageName, sandboxImageName } from "@/lib/sandbox/engine.mjs";
import type { SandboxMode } from "@/lib/sandbox/mode";

/**
 * The one place the sandbox spawns the `docker` CLI from: which engine it talks to (SANDBOX_DOCKER_HOST, else the
 * default context of this computer) and the tiny environment it gets.
 */

/** SANDBOX_DOCKER_HOST: a Docker host prepared by deploy/setup.sh. Without it the sandbox uses this computer's Docker. */
export function sandboxHost() {
  return process.env.SANDBOX_DOCKER_HOST?.trim() || null;
}

/** `remote` when SANDBOX_DOCKER_HOST is set, else `local`. Whether the engine is there is lib/sandbox/status.ts's question. */
export const dockerMode = (): SandboxMode => (sandboxHost() ? "remote" : "local");

/** The image sandbox containers run (SANDBOX_IMAGE). */
export const sandboxImage = () => sandboxImageName(process.env);

/** The browser image built from deploy/browser (SANDBOX_BROWSER_IMAGE overrides the tag the app expects). */
export const browserImage = () => browserImageName(process.env);

/** The environment of a docker CLI process (lib/sandbox/docker-env.ts). */
// Node's typings want NODE_ENV in a ProcessEnv; a spawned CLI doesn't need it.
export const dockerSpawnEnv = () => dockerCliEnv({ host: sandboxHost(), env: process.env, platform: process.platform }) as NodeJS.ProcessEnv;

const STDOUT_MAX = 12 * 1024 * 1024;
const STDERR_KEEP = 4_000;
const KILL_GRACE_MS = 15_000;

export type CliResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/**
 * The docker CLI with stdout kept apart from stderr and a large output cap (the browser's screenshot travels on stdout).
 * Rejects only when the CLI can't be spawned (no `docker` on PATH).
 */
export function dockerCli(args: string[], options: { input?: string; timeoutMs: number; name?: string }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: dockerSpawnEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > STDOUT_MAX) overflow = true;
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEEP);
    });

    let timedOut = false;
    let fallback: NodeJS.Timeout | undefined;
    const timer = setTimeout(
      () => {
        timedOut = true;
        // Killing the CLI wouldn't stop a remote container: kill it by name, then the CLI if it hangs on.
        if (options.name) void dockerCli(["kill", options.name], { timeoutMs: KILL_GRACE_MS }).catch(() => undefined);
        else child.kill();
        fallback = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      },
      Math.max(options.timeoutMs, 1)
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      resolve({ code, stdout: overflow ? "" : Buffer.concat(chunks).toString("utf8"), stderr, timedOut });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}
