import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteObject,
  filesDir,
  isValidKey,
  readObject,
  runScreenshotKey,
  uploadCardReference,
  uploadRunScreenshot,
  uploadWorkspaceLogo,
} from "@/lib/storage";

let dir: string;
const original = process.env.TECHTEAM_DATA_DIR;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "techteam-storage-"));
  process.env.TECHTEAM_DATA_DIR = dir;
});

afterEach(async () => {
  if (original === undefined) delete process.env.TECHTEAM_DATA_DIR;
  else process.env.TECHTEAM_DATA_DIR = original;
  await rm(dir, { recursive: true, force: true });
});

describe("keys", () => {
  it("accepts generated keys", () => {
    expect(isValidKey("card-references/1/2/3f2a.png")).toBe(true);
    expect(isValidKey(runScreenshotKey(1, 2, "abc"))).toBe(true);
  });

  it.each([
    "",
    "../x",
    "a/../../x",
    "a/./b",
    "a//b",
    "/etc/passwd",
    "C:\\x",
    "C:/x",
    "a\\..\\b",
    "a\\b",
    "%2e%2e/x",
    "a/%2e%2e/x",
    "a/..%2fb",
    "a/b\0.png",
    ".hidden",
    "a/.git/config",
    "a/",
  ])("rejects %j", (key) => {
    expect(isValidKey(key)).toBe(false);
  });

  it("never touches the disk for a bad key", async () => {
    await expect(readObject("../x")).rejects.toThrow();
    await expect(deleteObject("a/../../x")).rejects.toThrow();
    await expect(readObject("/etc/passwd")).rejects.toThrow();
  });
});

describe("files", () => {
  it("stores under <data dir>/files and reads back with a type from the extension", async () => {
    const key = await uploadCardReference({ workspaceId: 1, taskId: 2, ext: "md", contentType: "text/markdown", bytes: new TextEncoder().encode("# hi") });
    expect(key).toMatch(/^card-references\/1\/2\/[0-9a-f-]{36}\.md$/);
    expect(filesDir()).toBe(path.join(dir, "files"));
    const object = await readObject(key);
    expect(new TextDecoder().decode(object?.bytes)).toBe("# hi");
    expect(object?.contentType).toBe("text/markdown");
    expect((await readdir(path.join(dir, "files", "card-references", "1", "2"))).every((name) => !name.endsWith(".tmp"))).toBe(true);
  });

  it("stores logos and screenshots with their types", async () => {
    const logo = await uploadWorkspaceLogo(7, new File([new Uint8Array([1, 2, 3])], "l.jpg", { type: "image/jpeg" }));
    expect(logo).toMatch(/^workspace-logos\/7\/.+\.jpg$/);
    expect((await readObject(logo))?.contentType).toBe("image/jpeg");
    const shot = await uploadRunScreenshot(1, 2, new Uint8Array([9]));
    expect((await readObject(shot))?.contentType).toBe("image/png");
  });

  it("rejects an unsupported logo type and a bad extension", async () => {
    await expect(uploadWorkspaceLogo(1, new File(["<svg/>"], "l.svg", { type: "image/svg+xml" }))).rejects.toThrow();
    await expect(uploadCardReference({ workspaceId: 1, taskId: 1, ext: "../x", contentType: "x", bytes: new Uint8Array() })).rejects.toThrow();
  });

  it("returns null for a missing file and deletes idempotently", async () => {
    expect(await readObject("workspace-logos/1/none.png")).toBeNull();
    const key = await uploadRunScreenshot(1, 1, new Uint8Array([1]));
    await deleteObject(key);
    await deleteObject(key);
    expect(await readObject(key)).toBeNull();
  });

  it("does not follow a symlink out of the files folder", async () => {
    const outside = path.join(dir, "secret.png");
    await writeFile(outside, "secret");
    await mkdir(path.join(dir, "files", "workspace-logos"), { recursive: true });
    try {
      await symlink(outside, path.join(dir, "files", "workspace-logos", "link.png"));
    } catch {
      return; // Symlinks need a privilege on some Windows setups; nothing to test there.
    }
    expect(await readObject("workspace-logos/link.png")).toBeNull();
  });
});
