import { createCipheriv, randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const keys = vi.hoisted(() => ({ current: Buffer.alloc(32, 1) as Buffer | null }));

vi.mock("@/lib/secrets", () => ({
  getEncryptionKey: () => {
    if (!keys.current) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64.");
    return keys.current;
  },
}));

import { decrypt, encrypt, tryDecrypt } from "@/lib/crypto";

function encryptWith(key: Buffer, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

describe("tryDecrypt", () => {
  beforeEach(() => {
    keys.current = Buffer.alloc(32, 1);
  });

  it("reads what encrypt wrote", () => {
    expect(tryDecrypt(encrypt("sk-secret"))).toBe("sk-secret");
  });

  it("is null for a payload made with another key", () => {
    const payload = encryptWith(Buffer.alloc(32, 2), "sk-secret");
    expect(tryDecrypt(payload)).toBeNull();
    expect(() => decrypt(payload)).toThrow();
  });

  it("is null for a tampered tag or ciphertext", () => {
    const [version, iv, tag, ciphertext] = encrypt("sk-secret").split(".");
    const flip = (part: string) => `${part[0] === "A" ? "B" : "A"}${part.slice(1)}`;
    expect(tryDecrypt([version, iv, flip(tag), ciphertext].join("."))).toBeNull();
    expect(tryDecrypt([version, iv, tag, flip(ciphertext)].join("."))).toBeNull();
  });

  it("is null for garbage and for another version", () => {
    expect(tryDecrypt("")).toBeNull();
    expect(tryDecrypt("not-a-payload")).toBeNull();
    expect(tryDecrypt("v1.abc.def.ghi")).toBeNull();
    expect(tryDecrypt(encrypt("x").replace(/^v1/, "v2"))).toBeNull();
  });

  it("does not swallow a bad key configuration", () => {
    const payload = encrypt("sk-secret");
    keys.current = null;
    expect(() => tryDecrypt(payload)).toThrow("TOKEN_ENCRYPTION_KEY");
  });
});
