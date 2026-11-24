// Read-only access to the old S3 bucket, shared by `npm run storage:import-s3` and `npm run backup -- --with-s3`.
// It lists and reads objects and nothing else: no write, no delete command is imported here.
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export const S3_VARIABLES = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

/**
 * The bucket's settings from the environment, or the names of the missing required ones.
 * @param {Record<string, string | undefined>} env
 */
export function s3ConfigFromEnv(env) {
  const missing = S3_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { config: null, missing };
  return {
    missing: [],
    config: {
      bucket: /** @type {string} */ (env.S3_BUCKET).trim(),
      region: /** @type {string} */ (env.S3_REGION).trim(),
      accessKeyId: /** @type {string} */ (env.S3_ACCESS_KEY_ID).trim(),
      secretAccessKey: /** @type {string} */ (env.S3_SECRET_ACCESS_KEY).trim(),
      endpoint: env.S3_ENDPOINT?.trim() || undefined,
    },
  };
}

/**
 * Lists every object key of the bucket and reads one object's bytes.
 * @param {{ bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string }} config
 */
export function openS3Source(config) {
  const s3 = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    /** Object keys, page by page; "folder" placeholders (keys ending in `/`) are skipped. @returns {AsyncGenerator<string>} */
    async *keys() {
      let token;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: config.bucket, ContinuationToken: token }));
        for (const { Key: key } of page.Contents ?? []) {
          if (key && !key.endsWith("/")) yield key;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    /** @param {string} key @returns {Promise<Uint8Array>} */
    async read(key) {
      const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!object.Body) throw new Error("empty response");
      return object.Body.transformToByteArray();
    },
  };
}
