// One-time import: copies every object of the old S3 bucket into the local files folder (same keys).
// Reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and TECHTEAM_DATA_DIR.
// Skips files that already exist. Never deletes anything from S3. Run: npm run storage:import-s3
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, TECHTEAM_DATA_DIR } = process.env;
if (!S3_BUCKET || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error("Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (the old bucket's settings).");
  process.exit(1);
}

const base = path.resolve(TECHTEAM_DATA_DIR?.trim() || path.join(homedir(), ".techteam", "data"), "files");
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});

// The same rules as lib/storage.ts: a relative, forward-slash key with no empty, dot-leading or odd segment.
function safeTarget(key) {
  if (!key || key.includes("\0") || key.includes("\\") || key.includes(":") || key.includes("%")) return null;
  if (!key.split("/").every((segment) => segment !== "" && !segment.startsWith("."))) return null;
  const full = path.resolve(base, ...key.split("/"));
  const relative = path.relative(base, full);
  return !relative || relative.startsWith("..") || path.isAbsolute(relative) ? null : full;
}

const counts = { copied: 0, skipped: 0, refused: 0, failed: 0 };
let token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, ContinuationToken: token }));
  for (const { Key: key } of page.Contents ?? []) {
    if (!key || key.endsWith("/")) continue;
    const target = safeTarget(key);
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
      const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temp, await object.Body.transformToByteArray(), { flag: "wx", mode: 0o600 });
      await rename(temp, target);
      counts.copied += 1;
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      counts.failed += 1;
      console.error(`Failed ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

console.log(`Into ${base}: ${counts.copied} copied, ${counts.skipped} already there, ${counts.refused} refused, ${counts.failed} failed. Nothing was deleted from S3.`);
process.exit(counts.failed ? 1 : 0);
