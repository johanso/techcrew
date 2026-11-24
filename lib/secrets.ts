import "server-only";

import { randomBytes } from "node:crypto";

import { ensureSecretFile, resolveDataDir } from "@/lib/local-db-config.mjs";

/**
 * The two secrets TechTeam needs besides the database's: the key that encrypts tokens at rest and the one that signs
 * session cookies. Both live in the data dir (`~/.techteam/data` by default), generated on first use.
 */

const ENCRYPTION_KEY_FILE = "encryption.key";
const SESSION_SECRET_FILE = "session.secret";

/** A 32-byte key from its base64 text, or an error that says what is wrong. */
export function parseKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`${source} must be 32 bytes encoded as base64 (openssl rand -base64 32).`);
  }
  return key;
}

/** TOKEN_ENCRYPTION_KEY wins; otherwise the key in the data dir (`fromFile` creates it). A bad value never falls back. */
export function resolveEncryptionKey(env: Record<string, string | undefined>, fromFile: () => string): Buffer {
  const fromEnv = env.TOKEN_ENCRYPTION_KEY?.trim();
  return fromEnv ? parseKey(fromEnv, "TOKEN_ENCRYPTION_KEY") : parseKey(fromFile(), ENCRYPTION_KEY_FILE);
}

const generate = () => randomBytes(32).toString("base64");

let encryptionKey: Buffer | null = null;
let sessionSecret: Buffer | null = null;

/** The key for AES-256-GCM (lib/crypto.ts). Moving to another computer needs this file or the same env var. */
export function getEncryptionKey(): Buffer {
  encryptionKey ??= resolveEncryptionKey(process.env, () =>
    ensureSecretFile(resolveDataDir(process.env), ENCRYPTION_KEY_FILE, generate)
  );
  return encryptionKey;
}

/** The HMAC key of the session and sign-in cookies. Replacing it signs everyone out. */
export function getSessionSecret(): Buffer {
  sessionSecret ??= parseKey(ensureSecretFile(resolveDataDir(process.env), SESSION_SECRET_FILE, generate), SESSION_SECRET_FILE);
  return sessionSecret;
}
