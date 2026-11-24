// `npm run backup`: one archive with your database and files (docs/setup.md#moving-to-another-computer).
import { createInterface } from "node:readline/promises";

import { parseArgs } from "../lib/backup/cli-args.mjs";
import { runExport } from "../lib/backup/export.mjs";

const HELP = `npm run backup -- [options]

Writes one .tar.gz with every table of the database and the stored files. The database is only read.
Secrets (GitHub tokens, AI keys) are never included.

Reads DATABASE_URL (a remote database) or, when it is unset, the embedded database, which must be running
(npm run db:local or npm run dev).

Options
  --out <file>   Where to write it (default: techteam-backup-<date>-<time>.tar.gz in this folder)
  --with-s3      Also copy every object of the old S3 bucket (S3_BUCKET, S3_REGION, S3_ENDPOINT,
                 S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY from the environment; read only)
  --yes          Continue when agent runs are in flight (asked when you are at a terminal)
  --help         This text
`;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (args.positional.length > 0) throw new Error(`Unexpected argument ${args.positional[0]}. Try --help.`);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  await runExport({
    env: process.env,
    out: args.out,
    withS3: args.withS3,
    yes: args.yes,
    interactive,
    log: (message) => console.log(message),
    warn: (message) => console.warn(`Warning: ${message}`),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^y(es)?$/i.test((await rl.question(question)).trim());
      } finally {
        rl.close();
      }
    },
  });
  process.exit(0);
} catch (error) {
  console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
