/**
 * The local sandbox can't keep an install script away from the host's network (no firewall rules: deploy/setup.sh
 * does that on a remote host), so the install step runs `npm ci` and friends with `--ignore-scripts` unless the owner
 * allows scripts in Settings → Sandbox. Pure.
 */

const INSTALL_FLAG = "--ignore-scripts";
// Subcommands that fetch and (by default) run packages' lifecycle scripts.
const NPM_INSTALLS = new Set(["ci", "clean-install", "install", "i", "add", "install-test", "it"]);
const PNPM_INSTALLS = new Set(["install", "i", "add", "install-test", "it"]);
const YARN_INSTALLS = new Set(["install", "add"]);

// `&&`, `||`, `;`, `|` and newlines split a command line into simple commands; the separators are kept as they are.
const SEPARATORS = /(\s*(?:&&|\|\||[;|\n])\s*)/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OFF_FLAG = /^--(?:no-ignore-scripts|ignore-scripts=(?:false|0))$/;

/** Whether one simple command is an npm, pnpm or yarn install. */
function isInstaller(words: string[]) {
  let at = 0;
  while (at < words.length && ENV_ASSIGNMENT.test(words[at]!)) at++;
  // `npx --yes pnpm install`, `corepack yarn install`: the runner and its flags come first.
  if (words[at] === "npx" || words[at] === "corepack") {
    at++;
    while (at < words.length && words[at]!.startsWith("-")) at++;
  }
  const tool = words[at];
  if (tool !== "npm" && tool !== "pnpm" && tool !== "yarn") return false;
  const rest = words.slice(at + 1);
  const subcommand = rest.find((word) => !word.startsWith("-"));
  const installs = tool === "npm" ? NPM_INSTALLS : tool === "pnpm" ? PNPM_INSTALLS : YARN_INSTALLS;
  // A bare `yarn` (or `yarn --frozen-lockfile`) is `yarn install`.
  return subcommand === undefined ? tool === "yarn" : installs.has(subcommand);
}

function rewriteSimpleCommand(segment: string) {
  const lead = /^\s*/.exec(segment)?.[0] ?? "";
  const trail = /\s*$/.exec(segment)?.[0] ?? "";
  const body = segment.trim();
  if (!body) return segment;
  const words = body.split(/\s+/);
  if (!isInstaller(words)) return segment;
  // An owner's `--no-ignore-scripts` doesn't override this: scripts are on only through the Settings checkbox.
  const kept = words.map((word) => (OFF_FLAG.test(word) ? INSTALL_FLAG : word));
  const has = kept.some((word) => word === INSTALL_FLAG || word === "--ignore-scripts=true" || word === "--ignore-scripts=1");
  return `${lead}${kept.join(" ")}${has ? "" : ` ${INSTALL_FLAG}`}${trail}`;
}

/**
 * `command` with `--ignore-scripts` added to every npm, pnpm and yarn install in it, unless `allowScripts`. Other
 * commands (`npm run setup`, `make`, a quoted `sh -c`) are the owner's own and stay as written.
 */
export function localInstallCommand(command: string, allowScripts: boolean) {
  if (allowScripts) return command;
  return command
    .split(SEPARATORS)
    .map((part, index) => (index % 2 === 0 ? rewriteSimpleCommand(part) : part))
    .join("");
}
