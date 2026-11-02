import "server-only";

import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Private S3 storage for workspace logos. Objects are never public; they are served
 * through an ownership-checked route (app/api/workspaces/[id]/logo).
 */

export const LOGO_MAX_BYTES = 1024 * 1024;
// SVG is excluded on purpose: it can carry scripts and is served from our origin.
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as const;

let client: S3Client | null = null;

export function isStorageConfigured() {
  return Boolean(
    process.env.S3_BUCKET && process.env.S3_REGION && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
  );
}

function s3() {
  client ??= new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

export function isAllowedLogoType(type: string): type is keyof typeof LOGO_TYPES {
  return type in LOGO_TYPES;
}

export async function uploadWorkspaceLogo(ownerId: number, file: File) {
  if (!isAllowedLogoType(file.type)) throw new Error(`Unsupported logo type: ${file.type}`);
  const key = `workspace-logos/${ownerId}/${randomUUID()}.${LOGO_TYPES[file.type]}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type,
      CacheControl: "private, max-age=31536000, immutable",
    })
  );
  return key;
}

export async function readObject(key: string) {
  const res = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  if (!res.Body) return null;
  return { bytes: await res.Body.transformToByteArray(), contentType: res.ContentType ?? "application/octet-stream" };
}
