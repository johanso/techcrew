import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (GitHub access tokens).
 * Key: TOKEN_ENCRYPTION_KEY, 32 random bytes as base64 — `openssl rand -base64 32`.
 * Output format: `v1.<iv>.<authTag>.<ciphertext>` (base64url parts).
 */

function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : null;
  if (!buf || buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32).");
  }
  return buf;
}

export function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decrypt(payload: string) {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognized encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * A stable secret for `label` (e.g. the credential an outside service uses to call one agent's endpoint), derived
 * from TOKEN_ENCRYPTION_KEY so nothing extra is stored. Rotating the key changes every derived secret.
 */
export function deriveSecret(label: string) {
  return createHmac("sha256", key()).update(label).digest("base64url");
}
