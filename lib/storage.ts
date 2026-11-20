import "server-only";

import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Private S3 storage for workspace logos, the Tester's browser screenshots and card references. Objects are never
 * public; they are served through ownership-checked routes (app/api/workspaces/[id]/logo, app/api/runs/…/screenshot,
 * app/api/workspaces/[id]/references/[referenceId]), and reference images reach model providers as base64, never as a URL.
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

/**
 * A browse_preview screenshot (the Tester's browser), under its workspace and run. Served only to the workspace owner
 * (app/api/runs/[runId]/steps/[stepId]/screenshot). The caller checked that the bytes are a PNG.
 */
export async function uploadRunScreenshot(workspaceId: number, runId: number, png: Uint8Array) {
  const key = `run-screenshots/${workspaceId}/${runId}/${randomUUID()}.png`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: png,
      ContentType: "image/png",
      CacheControl: "private, max-age=31536000, immutable",
    })
  );
  return key;
}

/**
 * A card reference's file, or a PDF reference's extracted text (`ext` "txt"), under its workspace and card:
 * card-references/<workspaceId>/<taskId>/<uuid>.<ext>. The caller validated the bytes (lib/reference-config.ts).
 */
export async function uploadCardReference(input: { workspaceId: number; taskId: number; ext: string; contentType: string; bytes: Uint8Array }) {
  const key = `card-references/${input.workspaceId}/${input.taskId}/${randomUUID()}.${input.ext}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: input.bytes,
      ContentType: input.contentType,
      CacheControl: "private, max-age=31536000, immutable",
    })
  );
  return key;
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

export async function readObject(key: string) {
  const res = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  if (!res.Body) return null;
  return { bytes: await res.Body.transformToByteArray(), contentType: res.ContentType ?? "application/octet-stream" };
}
