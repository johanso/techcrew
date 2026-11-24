import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_GITHUB_CLIENT_ID as APP_DEFAULT } from "@/lib/github-client-id";

import { claudeCandidates, claudeChildEnv, claudeConfigDir, isNpmShim, parseAuthSummary } from "./claude.mjs";
import {
  DEFAULT_GITHUB_CLIENT_ID,
  checkAppUrl,
  checkClaude,
  checkDataDir,
  checkDatabase,
  checkDocker,
  checkEnvFile,
  checkExtras,
  checkGithub,
  checkNode,
  checkPorts,
  checkSecrets,
  checkTools,
  isValidKey,
  runChecks,
} from "./checks.mjs";
import { isObsoleteName, obsoleteKeysSet, parseEnvKeyNames } from "./env-hygiene.mjs";
import { exitCode, formatReport, summarize, toJson } from "./report.mjs";

const GOOD_KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const SECRET_VALUE = "super-secret-value-do-not-print";
const DATA = path.resolve("/data");
const POSTGRES = path.join(DATA, "postgres");

type Probes = Parameters<typeof checkNode>[0];

/** Probes for a healthy machine; each test overrides what it exercises. */
function probes(overrides: Partial<Probes> & { files?: Record<string, string>; listening?: number[] } = {}): Probes {
  const { files = {}, listening = [], ...rest } = overrides;
  return {
    env: { TECHTEAM_DATA_DIR: DATA },
    platform: "linux",
    home: "/home/u",
    nodeVersion: "22.20.0",
    root: path.resolve("/repo"),
    exists: (file: string) => file in files,
    readText: (file: string) => files[file] ?? null,
    canWrite: () => true,
    freeBytes: () => 50 * 1024 ** 3,
    run: async () => ({ code: 0, stdout: "1.0.0\n", stderr: "" }),
    portAnswers: async (port: number) => listening.includes(port),
    portOwner: async () => null,
    getJson: async () => null,
    reachable: async () => true,
    pidAlive: () => false,
    queryDatabase: async () => ({ reachable: true, applied: 3 }),
    envFileKeys: null,
    ...rest,
  };
}

const journal = (count: number) => JSON.stringify({ entries: Array.from({ length: count }, (_, idx) => ({ idx })) });
const journalPath = path.join(path.resolve("/repo"), "drizzle", "meta", "_journal.json");

describe("the GitHub client id", () => {
  it("is the same default as the app's", () => {
    expect(DEFAULT_GITHUB_CLIENT_ID).toBe(APP_DEFAULT);
  });
});

describe("checkNode", () => {
  it("accepts 22.18 and newer", async () => {
    for (const nodeVersion of ["22.18.0", "22.20.1", "24.0.0"]) {
      const [node] = await checkNode(probes({ nodeVersion }));
      expect(node?.status).toBe("ok");
    }
  });
  it("fails an older Node with a fix", async () => {
    for (const nodeVersion of ["22.17.9", "20.11.0", "v18.0.0"]) {
      const results = await checkNode(probes({ nodeVersion }));
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "node", status: "fail" });
      expect(results[0]?.hint).toMatch(/Node\.js/);
    }
  });
  it("fails when npm is missing", async () => {
    const results = await checkNode(probes({ run: async () => ({ code: null, stdout: "", stderr: "ENOENT" }) }));
    expect(results.find((entry) => entry.id === "npm")?.status).toBe("fail");
  });
});

describe("checkTools", () => {
  it("reports git and tar", async () => {
    const results = await checkTools(probes({ run: async (command) => ({ code: 0, stdout: command === "git" ? "git version 2.45.0\n" : "bsdtar 3.7\n", stderr: "" }) }));
    expect(results.map((entry) => [entry.id, entry.status])).toEqual([["git", "ok"], ["tar", "ok"]]);
    expect(results[0]?.detail).toBe("2.45.0");
  });
  it("fails each missing tool with a hint", async () => {
    const results = await checkTools(probes({ run: async (command) => ({ code: command === "git" ? null : 0, stdout: "", stderr: "" }) }));
    expect(results.find((entry) => entry.id === "git")).toMatchObject({ status: "fail" });
    expect(results.find((entry) => entry.id === "git")?.hint).toBeTruthy();
    expect(results.find((entry) => entry.id === "tar")?.status).toBe("ok");
  });
});

describe("checkDataDir", () => {
  it("is ok when writable with room, existing or not", () => {
    expect(checkDataDir(probes({ files: { [DATA]: "" } }))[0]).toMatchObject({ status: "ok" });
    expect(checkDataDir(probes())[0]?.detail).toMatch(/will be created/);
  });
  it("fails when it can't be written", () => {
    expect(checkDataDir(probes({ canWrite: () => false }))[0]).toMatchObject({ status: "fail" });
  });
  it("warns under 2 GB free", () => {
    expect(checkDataDir(probes({ freeBytes: () => 1.5 * 1024 ** 3 }))[0]).toMatchObject({ status: "warn" });
    expect(checkDataDir(probes({ freeBytes: () => 2 * 1024 ** 3 }))[0]?.status).toBe("ok");
    expect(checkDataDir(probes({ freeBytes: () => null }))[0]?.status).toBe("ok");
  });
});

describe("checkPorts", () => {
  it("says free when nothing answers", async () => {
    const results = await checkPorts(probes());
    expect(results.map((entry) => entry.status)).toEqual(["ok", "ok", "ok"]);
    expect(results.map((entry) => entry.detail)).toEqual(["port 3000 is free", "port 8288 is free", "port 54329 is free"]);
  });
  it("recognises TechTeam's own app, Inngest and database", async () => {
    const results = await checkPorts(
      probes({
        listening: [3000, 8288, 54329],
        getJson: async (url) => (url.endsWith("/api/inngest") ? { function_count: 4 } : { version: "1.53.0" }),
        files: { [path.join(POSTGRES, "postmaster.pid")]: "4242\n" },
        pidAlive: (pid) => pid === 4242,
      }),
    );
    expect(results.map((entry) => entry.status)).toEqual(["info", "info", "info"]);
    expect(results.every((entry) => /TechTeam is running/.test(entry.detail))).toBe(true);
  });
  it("warns, naming the program when known, for something else", async () => {
    const results = await checkPorts(probes({ listening: [3000, 54329], portOwner: async (port) => (port === 3000 ? "node.exe (pid 9)" : null) }));
    expect(results[0]).toMatchObject({ status: "warn", detail: "port 3000 is in use by node.exe (pid 9)" });
    expect(results[0]?.hint).toMatch(/TECHTEAM_PORT/);
    expect(results[2]).toMatchObject({ status: "warn", detail: "port 54329 is in use" });
    expect(results[2]?.hint).toMatch(/TECHTEAM_PG_PORT/);
  });
  it("treats a stale postmaster.pid as not TechTeam's", async () => {
    const results = await checkPorts(probes({ listening: [54329], files: { [path.join(POSTGRES, "postmaster.pid")]: "4242\n" }, pidAlive: () => false }));
    expect(results[2]?.status).toBe("warn");
  });
  it("follows the port settings", async () => {
    const results = await checkPorts(probes({ env: { TECHTEAM_DATA_DIR: DATA, TECHTEAM_PORT: "3995", TECHTEAM_INNGEST_PORT: "8299", TECHTEAM_PG_PORT: "54790" } }));
    expect(results.map((entry) => entry.detail)).toEqual(["port 3995 is free", "port 8299 is free", "port 54790 is free"]);
  });
});

describe("checkDatabase", () => {
  it("tests DATABASE_URL read-only and compares migrations with the journal", async () => {
    const env = { DATABASE_URL: `postgresql://u:${SECRET_VALUE}@db.example/x` };
    const seen: string[] = [];
    const ok = await checkDatabase(probes({ env, files: { [journalPath]: journal(3) }, queryDatabase: async (url) => (seen.push(url), { reachable: true, applied: 3 }) }));
    expect(seen).toEqual([env.DATABASE_URL]);
    expect(ok.map((entry) => entry.status)).toEqual(["ok", "ok"]);
    const behind = await checkDatabase(probes({ env, files: { [journalPath]: journal(5) } }));
    expect(behind[1]).toMatchObject({ id: "migrations", status: "warn", detail: "3 of 5 applied" });
    const none = await checkDatabase(probes({ env, files: { [journalPath]: journal(5) }, queryDatabase: async () => ({ reachable: true, applied: null }) }));
    expect(none[1]?.status).toBe("warn");
    const newer = await checkDatabase(probes({ env, files: { [journalPath]: journal(2) } }));
    expect(newer[1]?.status).toBe("info");
  });
  it("fails when DATABASE_URL doesn't answer, without showing it", async () => {
    const env = { DATABASE_URL: `postgresql://u:${SECRET_VALUE}@db.example/x` };
    const rows = await checkDatabase(probes({ env, queryDatabase: async () => ({ reachable: false, applied: null }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("fail");
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUE);
  });
  it("says an embedded cluster that doesn't exist yet is fine", async () => {
    expect((await checkDatabase(probes()))[0]).toMatchObject({ status: "info" });
  });
  it("says a stopped embedded cluster is fine", async () => {
    const rows = await checkDatabase(probes({ files: { [path.join(POSTGRES, "PG_VERSION")]: "18" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "info" });
  });
  it("checks a running embedded cluster with its own password", async () => {
    const urls: string[] = [];
    const files = {
      [path.join(POSTGRES, "PG_VERSION")]: "18",
      [path.join(POSTGRES, "postmaster.pid")]: "4242\n",
      [path.join(DATA, "postgres.secret")]: "abc123\n",
      [journalPath]: journal(3),
    };
    const rows = await checkDatabase(probes({ files, listening: [54329], pidAlive: () => true, queryDatabase: async (url) => (urls.push(url), { reachable: true, applied: 3 }) }));
    expect(rows.map((entry) => entry.status)).toEqual(["ok", "ok"]);
    expect(urls[0]).toContain("abc123");
    expect(JSON.stringify(rows)).not.toContain("abc123");
  });
  it("warns when a running embedded cluster refuses the test", async () => {
    const files = { [path.join(POSTGRES, "PG_VERSION")]: "18", [path.join(POSTGRES, "postmaster.pid")]: "4242\n" };
    const rows = await checkDatabase(probes({ files, listening: [54329], pidAlive: () => true, queryDatabase: async () => ({ reachable: false, applied: null }) }));
    expect(rows[0]?.status).toBe("warn");
  });
});

describe("checkAppUrl", () => {
  it("accepts local addresses", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3995"]) {
      expect(checkAppUrl(probes({ env: { NEXT_PUBLIC_APP_URL: url } }))[0]?.status).toBe("ok");
    }
  });
  it("warns when unset, remote or malformed", () => {
    for (const url of [undefined, "https://techteam.example.com", "not a url"]) {
      const row = checkAppUrl(probes({ env: { NEXT_PUBLIC_APP_URL: url } }))[0];
      expect(row?.status).toBe("warn");
      expect(row?.hint).toBeTruthy();
    }
  });
});

describe("checkSecrets", () => {
  const file = (value: string) => ({ [path.join(DATA, "encryption.key")]: `${value}\n` });
  it("validates keys", () => {
    expect(isValidKey(GOOD_KEY)).toBe(true);
    expect(isValidKey("short")).toBe(false);
  });
  it("is info when no key exists yet", () => {
    expect(checkSecrets(probes())[0]).toMatchObject({ status: "info" });
  });
  it("accepts a key from the environment or the file", () => {
    expect(checkSecrets(probes({ env: { TECHTEAM_DATA_DIR: DATA, TOKEN_ENCRYPTION_KEY: GOOD_KEY } }))[0]?.status).toBe("ok");
    expect(checkSecrets(probes({ files: file(GOOD_KEY) }))[0]?.status).toBe("ok");
  });
  it("fails an invalid key, never falling back", () => {
    expect(checkSecrets(probes({ env: { TECHTEAM_DATA_DIR: DATA, TOKEN_ENCRYPTION_KEY: "nope" }, files: file(GOOD_KEY) }))[0]?.status).toBe("fail");
    expect(checkSecrets(probes({ files: file("nope") }))[0]?.status).toBe("fail");
  });
  it("warns when the environment's key differs from the file's, comparing hashes only", () => {
    const rows = checkSecrets(probes({ env: { TECHTEAM_DATA_DIR: DATA, TOKEN_ENCRYPTION_KEY: GOOD_KEY }, files: file(OTHER_KEY) }));
    expect(rows[0]?.status).toBe("warn");
    expect(JSON.stringify(rows)).not.toContain(GOOD_KEY);
    expect(JSON.stringify(rows)).not.toContain(OTHER_KEY);
    expect(checkSecrets(probes({ env: { TECHTEAM_DATA_DIR: DATA, TOKEN_ENCRYPTION_KEY: GOOD_KEY }, files: file(GOOD_KEY) }))[0]?.status).toBe("ok");
  });
});

describe("checkGithub", () => {
  it("uses the project's app by default and an own one when set", async () => {
    expect((await checkGithub(probes()))[0]?.detail).toMatch(/project's/);
    expect((await checkGithub(probes({ env: { GITHUB_CLIENT_ID: "Iv1.own" } })))[0]?.detail).toMatch(/your own/);
    expect((await checkGithub(probes({ env: { GITHUB_CLIENT_ID: DEFAULT_GITHUB_CLIENT_ID } })))[0]?.detail).toMatch(/project's/);
  });
  it("warns when github.com isn't reachable", async () => {
    const rows = await checkGithub(probes({ reachable: async () => false }));
    expect(rows[1]).toMatchObject({ id: "github-net", status: "warn" });
    expect((await checkGithub(probes()))[1]?.status).toBe("ok");
  });
});

describe("claude binary lookup", () => {
  it("lists the Windows places, CLAUDE_CLI_PATH first", () => {
    const list = claudeCandidates({ platform: "win32", home: "C:\\Users\\u", env: { CLAUDE_CLI_PATH: "D:\\c\\claude.exe", USERPROFILE: "C:\\Users\\u", APPDATA: "C:\\Users\\u\\AppData\\Roaming" } });
    expect(list).toEqual(["D:\\c\\claude.exe", "C:\\Users\\u\\.local\\bin\\claude.exe", "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd"]);
  });
  it("lists the POSIX places", () => {
    expect(claudeCandidates({ platform: "darwin", home: "/Users/u", env: {} })).toEqual([
      "/Users/u/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/Users/u/.claude/local/claude",
    ]);
  });
  it("finds npm shims and the config dir", () => {
    expect(isNpmShim("C:\\x\\Claude.CMD")).toBe(true);
    expect(isNpmShim("C:\\x\\claude.exe")).toBe(false);
    expect(claudeConfigDir({}, "/home/u")).toBe(path.join("/home/u", ".techteam", "cli", "claude"));
    expect(claudeConfigDir({ TECHTEAM_CLI_HOME: "/cli" }, "/home/u")).toBe(path.join("/cli", "claude"));
  });
  it("runs Claude with an allowlisted environment and TechTeam's config dir", () => {
    const env = claudeChildEnv({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: SECRET_VALUE, DATABASE_URL: SECRET_VALUE }, "/cfg");
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h", CLAUDE_CONFIG_DIR: "/cfg" });
    expect(JSON.stringify(env)).not.toContain(SECRET_VALUE);
  });
  it("keeps only whether and how Claude is signed in", () => {
    const auth = parseAuthSummary(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "Max", email: "me@example.com", orgName: "Acme" }));
    expect(auth).toEqual({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });
    expect(parseAuthSummary("garbage")).toEqual({ loggedIn: false, authMethod: null, subscriptionType: null });
  });
});

describe("checkClaude", () => {
  const binary = "/home/u/.local/bin/claude";
  it("is info when not installed", async () => {
    expect((await checkClaude(probes()))[0]).toMatchObject({ id: "claude", status: "info" });
  });
  it("reports the version and the sign-in without the account", async () => {
    const calls: string[][] = [];
    const rows = await checkClaude(
      probes({
        files: { [binary]: "" },
        run: async (_command, args, options) => {
          calls.push(args);
          expect(options?.env?.CLAUDE_CONFIG_DIR).toBe(path.join("/home/u", ".techteam", "cli", "claude"));
          return args[0] === "--version"
            ? { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" }
            : { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", email: "me@example.com" }), stderr: "" };
        },
      }),
    );
    expect(rows.map((entry) => entry.status)).toEqual(["ok", "ok"]);
    expect(rows[1]?.detail).toBe("signed in (claude.ai, plan pro)");
    expect(JSON.stringify(rows)).not.toContain("me@example.com");
    expect(calls).toEqual([["--version"], ["auth", "status", "--json"]]);
  });
  it("says not signed in as info", async () => {
    const rows = await checkClaude(probes({ files: { [binary]: "" }, run: async () => ({ code: 0, stdout: "{\"loggedIn\":false}", stderr: "" }) }));
    expect(rows[1]?.status).toBe("info");
  });
  it("warns about an npm shim on Windows without running it", async () => {
    const shim = path.win32.join("C:\\Users\\u\\AppData\\Roaming", "npm", "claude.cmd");
    let ran = false;
    const rows = await checkClaude(
      probes({ platform: "win32", home: "C:\\Users\\u", env: { USERPROFILE: "C:\\Users\\u", APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, files: { [shim]: "" }, run: async () => ((ran = true), { code: 0, stdout: "", stderr: "" }) }),
    );
    expect(rows[0]).toMatchObject({ status: "warn" });
    expect(ran).toBe(false);
  });
  it("warns when the binary doesn't start", async () => {
    const rows = await checkClaude(probes({ files: { [binary]: "" }, run: async () => ({ code: 1, stdout: "", stderr: "boom" }) }));
    expect(rows[0]?.status).toBe("warn");
  });
});

describe("checkExtras", () => {
  it("only informs, and looks for WSL on Windows only", async () => {
    const missing = probes({ run: async () => ({ code: null, stdout: "", stderr: "" }) });
    const linux = await checkExtras(missing);
    expect(linux.map((entry) => [entry.id, entry.status])).toEqual([["docker", "info"]]);
    const windows = await checkExtras({ ...missing, platform: "win32" });
    expect(windows.map((entry) => [entry.id, entry.status])).toEqual([["docker", "info"], ["wsl", "info"]]);
  });
});

describe("checkDocker", () => {
  type Reply = { code: number | null; stdout: string; stderr: string };
  /** A fake docker CLI: `--version`, `info` and `image inspect` each answer as given. */
  const docker = (replies: { version?: Reply; info?: Reply; images?: (image: string) => boolean }) =>
    probes({
      run: async (_command: string, args: string[]) => {
        if (args[0] === "--version") return replies.version ?? { code: null, stdout: "", stderr: "" };
        if (args[0] === "info") return replies.info ?? { code: 1, stdout: "", stderr: "" };
        if (args[0] === "image") return { code: replies.images?.(args[args.length - 1]!) ? 0 : 1, stdout: "", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
  const installed = { code: 0, stdout: "Docker version 27.3.1, build ce12230\n", stderr: "" };

  it("says when Docker isn't installed", async () => {
    const rows = await checkDocker(docker({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "docker", status: "info", detail: expect.stringContaining("not found") });
    expect(rows[0]?.hint).toMatch(/Install Docker/);
  });

  it("says when the engine is stopped", async () => {
    const rows = await checkDocker(docker({ version: installed, info: { code: 1, stdout: "", stderr: "cannot connect" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "info", detail: expect.stringContaining("27.3.1") });
    expect(rows[0]?.detail).toMatch(/isn't running/);
    expect(rows[0]?.hint).toMatch(/Start Docker Desktop/);
  });

  it("says when Docker is in Windows-containers mode", async () => {
    const rows = await checkDocker(docker({ version: installed, info: { code: 0, stdout: "windows|26.0.0\n", stderr: "" } }));
    expect(rows[0]?.detail).toMatch(/Windows-containers/);
    expect(rows[0]?.hint).toMatch(/Linux containers/);
  });

  it("points to npm run sandbox:setup while an image is missing, and is quiet once both are there", async () => {
    const info = { code: 0, stdout: "linux|27.3.1\n", stderr: "" };
    const none = await checkDocker(docker({ version: installed, info, images: () => false }));
    expect(none.map((row) => [row.id, row.status])).toEqual([["docker", "info"], ["sandbox-images", "info"]]);
    expect(none[0]?.detail).toMatch(/ready/);
    expect(none[1]?.detail).toContain("2 of 2");
    expect(none[1]?.hint).toContain("npm run sandbox:setup");
    const onlyBrowserMissing = await checkDocker(docker({ version: installed, info, images: (image) => image.startsWith("node:") }));
    expect(onlyBrowserMissing[1]?.detail).toContain("1 of 2");
    const all = await checkDocker(docker({ version: installed, info, images: () => true }));
    expect(all[1]).toMatchObject({ status: "info", detail: "installed" });
    expect(all[1]?.hint).toBeUndefined();
  });

  it("doesn't probe this computer's Docker when the sandbox runs on a remote host", async () => {
    let ran = false;
    const rows = await checkDocker(probes({ env: { SANDBOX_DOCKER_HOST: "ssh://u@h" }, run: async () => ((ran = true), { code: 0, stdout: "", stderr: "" }) }));
    expect(ran).toBe(false);
    expect(rows[0]?.detail).toMatch(/remote host/);
  });

  it("never reports more than info", async () => {
    const info = { code: 0, stdout: "linux|27.3.1\n", stderr: "" };
    for (const probe of [docker({}), docker({ version: installed }), docker({ version: installed, info, images: () => false })]) {
      for (const row of await checkDocker(probe)) expect(row.status).toBe("info");
    }
  });
});

describe("the .env detector", () => {
  it("knows the obsolete names", () => {
    for (const name of ["AUTH_URL", "AUTH_PUBLISHABLE_KEY", "AUTH_SECRET_KEY", "GITHUB_CLIENT_SECRET", "S3_BUCKET", "JOBS_API_KEY", "SWITCH_AGENT_AI_API_KEY", "PUBLIC_APP_URL", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) {
      expect(isObsoleteName(name)).toBe(true);
    }
    for (const name of ["GITHUB_CLIENT_ID", "DATABASE_URL", "NEXT_PUBLIC_APP_URL", "OPENAI_API_KEY", "TOKEN_ENCRYPTION_KEY"]) {
      expect(isObsoleteName(name)).toBe(false);
    }
  });
  it("parses key names, never values", () => {
    const names = parseEnvKeyNames(`# comment\nS3_BUCKET=${SECRET_VALUE}\nexport JOBS_API_KEY = "${SECRET_VALUE}"\n\n  OPENAI_API_KEY=\n#X=1\nnot a line\r\nAUTH_URL=x\r\n`);
    expect(names).toEqual(["S3_BUCKET", "JOBS_API_KEY", "OPENAI_API_KEY", "AUTH_URL"]);
    expect(JSON.stringify(names)).not.toContain(SECRET_VALUE);
  });
  it("lists only declared, non-empty, obsolete settings", () => {
    const env = { S3_BUCKET: SECRET_VALUE, JOBS_API_KEY: "", AUTH_URL: "x", OPENAI_API_KEY: "k", SWITCH_X: SECRET_VALUE };
    expect(obsoleteKeysSet(["S3_BUCKET", "JOBS_API_KEY", "AUTH_URL", "OPENAI_API_KEY", "S3_BUCKET"], env)).toEqual(["AUTH_URL", "S3_BUCKET"]);
  });
});

describe("checkEnvFile", () => {
  it("says nothing without an .env", () => {
    expect(checkEnvFile(probes())).toEqual([]);
  });
  it("warns with names only for obsolete settings", () => {
    const rows = checkEnvFile(probes({ envFileKeys: ["S3_BUCKET", "AUTH_URL"], env: { S3_BUCKET: SECRET_VALUE, AUTH_URL: SECRET_VALUE } }));
    expect(rows[0]).toMatchObject({ status: "warn", detail: "no longer used: AUTH_URL, S3_BUCKET" });
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUE);
  });
  it("is ok when clean, and informs about an own OAuth App and an own database", () => {
    expect(checkEnvFile(probes({ envFileKeys: ["OPENAI_API_KEY"] }))[0]?.status).toBe("ok");
    const rows = checkEnvFile(probes({ envFileKeys: ["GITHUB_CLIENT_ID", "DATABASE_URL"], env: { GITHUB_CLIENT_ID: "Iv1.own", DATABASE_URL: `postgres://u:${SECRET_VALUE}@h/d` } }));
    expect(rows.map((entry) => entry.status)).toEqual(["ok", "info", "info"]);
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(rows)).not.toContain("Iv1.own");
  });
});

describe("the report", () => {
  const results = [
    { id: "a", label: "A", status: "ok" as const, detail: "fine" },
    { id: "b", label: "B", status: "info" as const, detail: "meh", hint: "note" },
    { id: "c", label: "C", status: "warn" as const, detail: "hmm", hint: "do x" },
  ];
  it("prints one line per check with the fix under warnings and problems", () => {
    const text = formatReport(results);
    expect(text).toContain("✓ A: fine");
    expect(text).toContain("i B: meh");
    expect(text).toContain("! C: hmm\n    Fix: do x");
    expect(text).toContain("No problems, 1 warning.");
  });
  it("marks problems and exits 1 only for them", () => {
    const failing = [...results, { id: "d", label: "D", status: "fail" as const, detail: "bad", hint: "fix it" }];
    expect(formatReport(failing)).toContain("✗ D: bad");
    expect(formatReport(failing)).toContain("1 problem, 1 warning.");
    expect(exitCode(failing)).toBe(1);
    expect(exitCode(results)).toBe(0);
    expect(summarize(failing)).toEqual({ ok: 1, info: 1, warn: 1, fail: 1 });
  });
  it("has a stable JSON shape", () => {
    const parsed = JSON.parse(toJson(results));
    expect(Object.keys(parsed)).toEqual(["ok", "summary", "checks"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks[2]).toEqual({ id: "c", label: "C", status: "warn", detail: "hmm", hint: "do x" });
  });
});

describe("runChecks", () => {
  it("never prints a value from the environment, in text or JSON", async () => {
    const env = {
      TECHTEAM_DATA_DIR: DATA,
      DATABASE_URL: `postgresql://u:${SECRET_VALUE}@db.example/x`,
      TOKEN_ENCRYPTION_KEY: GOOD_KEY,
      OPENAI_API_KEY: SECRET_VALUE,
      S3_SECRET_ACCESS_KEY: SECRET_VALUE,
      AUTH_SECRET_KEY: SECRET_VALUE,
      GITHUB_CLIENT_ID: `Iv1.${SECRET_VALUE}`,
      NEXT_PUBLIC_APP_URL: `http://localhost:3000/${SECRET_VALUE}`,
    };
    const files = { [path.join(DATA, "encryption.key")]: `${OTHER_KEY}\n`, [journalPath]: journal(3) };
    const results = await runChecks(probes({ env, files, envFileKeys: Object.keys(env) }));
    const everything = `${formatReport(results)}\n${toJson(results)}`;
    for (const secret of [SECRET_VALUE, GOOD_KEY, OTHER_KEY]) expect(everything).not.toContain(secret);
    expect(results.some((entry) => entry.status === "warn")).toBe(true);
  });
  it("is all good on a healthy machine", async () => {
    const results = await runChecks(probes({ env: { TECHTEAM_DATA_DIR: DATA, NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
    expect(exitCode(results)).toBe(0);
    expect(results.filter((entry) => entry.status === "fail")).toEqual([]);
  });
  it("matches the repository's journal file shape", () => {
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "drizzle", "meta", "_journal.json"), "utf8"));
    expect(Array.isArray(real.entries)).toBe(true);
  });
});
