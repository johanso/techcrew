// `npm run doctor`: checks this computer for what TechTeam needs and says how to fix what is missing.
// Prints one line per check (✓ ok, i info, ! warning, ✗ problem) and exits 1 only on a ✗. Never prints a secret or a
// value from .env. `--json` prints the same as JSON.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks } from "../lib/doctor/checks.mjs";
import { realProbes } from "../lib/doctor/probes.mjs";
import { exitCode, formatReport, toJson } from "../lib/doctor/report.mjs";

const HELP = `npm run doctor -- [--json]

Checks Node, git, the data folder, ports, the database, secrets, GitHub, Claude Code and your .env.
  --json   Print the result as JSON
  --help   This text
`;

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
const unknown = args.find((arg) => arg !== "--json");
if (unknown) {
  console.error(`Unknown option ${unknown}. Try --help.`);
  process.exit(2);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = await runChecks(realProbes(root));
console.log(args.includes("--json") ? toJson(results) : formatReport(results));
process.exit(exitCode(results));
