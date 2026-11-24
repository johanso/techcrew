import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureSecretFile, readSecretFile } from "@/lib/local-db-config.mjs";
import { parseKey, resolveEncryptionKey } from "@/lib/secrets";

const goodKey = Buffer.alloc(32, 1).toString("base64");
const fileKey = Buffer.alloc(32, 2).toString("base64");

describe("resolveEncryptionKey", () => {
  it("uses TOKEN_ENCRYPTION_KEY when it is set and never touches the file", () => {
    const key = resolveEncryptionKey({ TOKEN_ENCRYPTION_KEY: goodKey }, () => {
      throw new Error("the file must not be read");
    });
    expect(key.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("falls back to the data dir's key when the variable is unset or blank", () => {
    expect(resolveEncryptionKey({}, () => fileKey).equals(Buffer.alloc(32, 2))).toBe(true);
    expect(resolveEncryptionKey({ TOKEN_ENCRYPTION_KEY: "  " }, () => fileKey).equals(Buffer.alloc(32, 2))).toBe(true);
  });

  it("rejects a wrong-length or non-base64 variable instead of falling back", () => {
    expect(() => resolveEncryptionKey({ TOKEN_ENCRYPTION_KEY: "your_32_byte_base64_key" }, () => fileKey)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => resolveEncryptionKey({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }, () => fileKey)).toThrow(/32 bytes/);
  });

  it("rejects a damaged key file", () => {
    expect(() => resolveEncryptionKey({}, () => "###")).toThrow(/encryption\.key/);
  });
});

describe("parseKey", () => {
  it("accepts exactly 32 bytes", () => {
    expect(parseKey(` ${goodKey}\n`, "x")).toHaveLength(32);
    expect(() => parseKey(Buffer.alloc(33).toString("base64"), "x")).toThrow();
    expect(() => parseKey("", "x")).toThrow();
  });
});

describe("secret files", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techteam-secret-"));
    dirs.push(dir);
    return path.join(dir, "data");
  };

  it("creates the file once, creating the folder too, and keeps its value", () => {
    const dir = tempDir();
    expect(readSecretFile(dir, "session.secret")).toBeNull();
    expect(ensureSecretFile(dir, "session.secret", () => "first")).toBe("first");
    expect(ensureSecretFile(dir, "session.secret", () => "second")).toBe("first");
    expect(readSecretFile(dir, "session.secret")).toBe("first");
  });

  it("keeps separate files apart", () => {
    const dir = tempDir();
    ensureSecretFile(dir, "a.secret", () => "A");
    ensureSecretFile(dir, "b.secret", () => "B");
    expect(readSecretFile(dir, "a.secret")).toBe("A");
    expect(readSecretFile(dir, "b.secret")).toBe("B");
  });

  it("is owner-only where the system has permissions", () => {
    if (process.platform === "win32") return;
    const dir = tempDir();
    ensureSecretFile(dir, "session.secret", () => "x");
    expect(fs.statSync(path.join(dir, "session.secret")).mode & 0o777).toBe(0o600);
  });

  it("reads an empty file as missing", () => {
    const dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "k"), "\n");
    expect(readSecretFile(dir, "k")).toBeNull();
  });
});
