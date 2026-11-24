import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PG_PORT,
  embeddedApplies,
  embeddedUrl,
  ensureSecret,
  parsePidFile,
  pgDataDir,
  pidFileState,
  readSecret,
  readyPath,
  resolveDataDir,
  resolvePort,
  secretPath,
} from "./local-db-config.mjs";

describe("resolveDataDir", () => {
  it("uses TECHTEAM_DATA_DIR, trimmed", () => {
    expect(resolveDataDir({ TECHTEAM_DATA_DIR: "  /x/data  " }, "/home/u")).toBe(path.resolve("/x/data"));
  });
  it("defaults to ~/.techteam/data", () => {
    expect(resolveDataDir({}, "/home/u")).toBe(path.join("/home/u", ".techteam", "data"));
    expect(resolveDataDir({ TECHTEAM_DATA_DIR: "   " }, "/home/u")).toBe(path.join("/home/u", ".techteam", "data"));
  });
  it("keeps the cluster and the secret inside the data dir", () => {
    expect(pgDataDir("/d")).toBe(path.join("/d", "postgres"));
    expect(secretPath("/d")).toBe(path.join("/d", "postgres.secret"));
    expect(readyPath("/d")).toBe(path.join("/d", "postgres.ready"));
  });
});

describe("embeddedApplies", () => {
  it("only when DATABASE_URL is unset or blank", () => {
    expect(embeddedApplies({})).toBe(true);
    expect(embeddedApplies({ DATABASE_URL: "  " })).toBe(true);
    expect(embeddedApplies({ DATABASE_URL: "postgresql://a" })).toBe(false);
  });
});

describe("resolvePort", () => {
  it("defaults, overrides and rejects garbage", () => {
    expect(resolvePort({})).toBe(DEFAULT_PG_PORT);
    expect(resolvePort({ TECHTEAM_PG_PORT: " 54777 " })).toBe(54777);
    expect(resolvePort({ TECHTEAM_PG_PORT: "abc" })).toBe(DEFAULT_PG_PORT);
    expect(resolvePort({ TECHTEAM_PG_PORT: "70000" })).toBe(DEFAULT_PG_PORT);
    expect(resolvePort({ TECHTEAM_PG_PORT: "0" })).toBe(DEFAULT_PG_PORT);
  });
});

describe("embeddedUrl", () => {
  it("listens on loopback and escapes the secret", () => {
    expect(embeddedUrl(54329, "ab/c")).toBe("postgresql://techteam:ab%2Fc@127.0.0.1:54329/techteam");
  });
});

describe("postmaster.pid", () => {
  it("reads the first line", () => {
    expect(parsePidFile("1234\n/data\n1700000000\n")).toBe(1234);
    expect(parsePidFile("1234\r\nx")).toBe(1234);
    expect(parsePidFile("")).toBeNull();
    expect(parsePidFile("abc\n")).toBeNull();
    expect(parsePidFile("0\n")).toBeNull();
  });
  it("tells none, running and stale apart", () => {
    expect(pidFileState(null, () => true)).toBe("none");
    expect(pidFileState("42\n", () => true)).toBe("running");
    expect(pidFileState("42\n", () => false)).toBe("stale");
    expect(pidFileState("garbage", () => true)).toBe("stale");
  });
});

describe("secret file", () => {
  it("is generated once and then reused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techteam-secret-"));
    try {
      expect(readSecret(dir)).toBeNull();
      expect(ensureSecret(dir, () => "first")).toBe("first");
      expect(ensureSecret(dir, () => "second")).toBe("first");
      expect(readSecret(dir)).toBe("first");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
