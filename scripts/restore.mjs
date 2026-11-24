// `npm run restore`: an archive made by `npm run backup` into an empty database (docs/setup.md#moving-to-another-computer).
import { parseArgs } from "../lib/backup/cli-args.mjs";
import { runRestore } from "../lib/backup/import.mjs";

const HELP = `npm run restore -- <archive.tar.gz>

Restores a backup into an empty database and copies its files into the data folder (TECHTEAM_DATA_DIR).
It never overwrites: it refuses a database that already has a user or a workspace.

Reads DATABASE_URL or, when it is unset, the embedded database, which must be running
(npm run db:local or npm run dev). With DATABASE_URL, run npm run db:migrate first.

Everything goes in one transaction: if anything is wrong, no row is restored.
After restoring, sign in with GitHub and enter your AI keys again.
`;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (args.positional.length !== 1 || args.out || args.withS3 || args.yes) throw new Error("Give exactly one archive file: npm run restore -- <archive.tar.gz>");
  await runRestore({
    env: process.env,
    archive: args.positional[0],
    log: (message) => console.log(message),
    warn: (message) => console.warn(`Warning: ${message}`),
  });
  process.exit(0);
} catch (error) {
  console.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
