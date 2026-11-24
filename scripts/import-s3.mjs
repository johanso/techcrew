// One-time import: copies every object of the old S3 bucket into the local files folder (same keys).
// Reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and TECHTEAM_DATA_DIR.
// Skips files that already exist. Never deletes anything from S3. Run: npm run storage:import-s3
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveDataDir } from "../lib/local-db-config.mjs";
import { openS3Source, s3ConfigFromEnv } from "../lib/s3-source.mjs";
import { keyPath } from "../lib/storage-key.mjs";

const { config, missing } = s3ConfigFromEnv(process.env);
if (!config) {
  console.error(`Set ${missing.join(", ")} (the old bucket's settings).`);
  process.exit(1);
}

const base = path.join(resolveDataDir(process.env), "files");
const source = openS3Source(config);

const counts = { copied: 0, skipped: 0, refused: 0, failed: 0 };
for await (const key of source.keys()) {
  const target = keyPath(base, key);
  if (!target) {
    counts.refused += 1;
    console.warn(`Refused unsafe key: ${JSON.stringify(key)}`);
    continue;
  }
  if (await stat(target).then(() => true, () => false)) {
    counts.skipped += 1;
    continue;
  }
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const bytes = await source.read(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await rename(temp, target);
    counts.copied += 1;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    counts.failed += 1;
    console.error(`Failed ${key}: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(`Into ${base}: ${counts.copied} copied, ${counts.skipped} already there, ${counts.refused} refused, ${counts.failed} failed. Nothing was deleted from S3.`);
process.exit(counts.failed ? 1 : 0);
