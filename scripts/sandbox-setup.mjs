// `npm run sandbox:setup`: gets the two images the agent sandbox needs onto this computer's Docker (docs/sandbox.md):
// the sandbox image (downloaded when missing) and the browser image (built from deploy/browser). Idempotent, never
// removes anything. `--check` only reports. A remote SANDBOX_DOCKER_HOST is refused unless `--remote`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOCKER_INFO_FORMAT, browserImageName, parseDockerInfo, sandboxImageName } from "../lib/sandbox/engine.mjs";
import { describeStep, formatImageSize, parseSetupArgs, setupPlan } from "../lib/sandbox/setup-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseSetupArgs(process.argv.slice(2));

if (args.help || args.unknown.length) {
  if (args.unknown.length) console.error(`Unknown option: ${args.unknown.join(" ")}`);
  console.log("Usage: npm run sandbox:setup [-- --check] [-- --remote]\n  --check   only report what is installed\n  --remote  prepare the images on SANDBOX_DOCKER_HOST instead of refusing");
  process.exit(args.unknown.length ? 1 : 0);
}

const remoteHost = process.env.SANDBOX_DOCKER_HOST?.trim() || null;
// The app talks to this computer's default engine unless SANDBOX_DOCKER_HOST is set: the setup talks to the same one.
const env = { ...process.env };
delete env.DOCKER_HOST;
if (remoteHost && args.remote) env.DOCKER_HOST = remoteHost;

/** @param {string[]} dockerArgs @param {{ inherit?: boolean }} [options] */
function docker(dockerArgs, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn("docker", dockerArgs, { env, windowsHide: true, stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.on("error", (error) => resolve({ code: null, stdout, errorCode: /** @type {NodeJS.ErrnoException} */ (error).code ?? null }));
    child.on("close", (code) => resolve({ code, stdout, errorCode: null }));
  });
}

const images = { sandbox: sandboxImageName(process.env), browser: browserImageName(process.env) };
const info = await docker(["info", `--format=${DOCKER_INFO_FORMAT}`]);
const engine = parseDockerInfo(info);
const has = async (/** @type {string} */ image) => (await docker(["image", "inspect", "--format={{.Id}}", image])).code === 0;
const present = engine.kind === "engine" ? { sandbox: await has(images.sandbox), browser: await has(images.browser) } : { sandbox: false, browser: false };

const plan = setupPlan({ remoteHost, remoteFlag: args.remote, engine, present, images });
if (plan.refusal) {
  console.error(plan.refusal);
  process.exit(1);
}
for (const step of plan.steps) console.log(describeStep(step));

if (!args.check) {
  const started = Date.now();
  for (const step of plan.steps) {
    if (step.action === "have") continue;
    console.log(`\n${step.action === "pull" ? "Downloading" : "Building"} ${step.image} ...`);
    const done = await docker(step.action === "pull" ? ["pull", step.image] : ["build", "--pull", "-t", step.image, path.join(root, "deploy", "browser")], { inherit: true });
    if (done.code !== 0) {
      console.error(`\nCouldn't ${step.action === "pull" ? "download" : "build"} ${step.image}. Fix the message above and run this again; nothing was removed.`);
      process.exit(1);
    }
  }
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s.`);
}

for (const step of plan.steps) {
  const size = await docker(["image", "inspect", "--format={{.Size}}", step.image]);
  console.log(`${step.image}: ${size.code === 0 ? formatImageSize(Number(size.stdout.trim())) : "not installed"}`);
}
