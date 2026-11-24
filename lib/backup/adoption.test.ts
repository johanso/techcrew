import { describe, expect, it } from "vitest";

import { activeRunsDecision, activeRunsWarning } from "./active-runs.mjs";
import { backfillGithubUserIds } from "./adoption.mjs";
import { parseArgs } from "./cli-args.mjs";

describe("backfillGithubUserIds", () => {
  it("gives a user without a GitHub id the one of its saved connection", () => {
    const result = backfillGithubUserIds(
      [
        { id: 1, github_user_id: null, email: "a@x" },
        { id: 2, github_user_id: "77", email: "b@x" },
      ],
      [
        { userId: 1, githubUserId: "9007199254740993" },
        { userId: 2, githubUserId: "88" },
      ],
    );
    expect(result.filled).toBe(1);
    expect(result.users[0].github_user_id).toBe("9007199254740993");
    expect(result.users[1].github_user_id).toBe("77");
  });

  it("never changes a user that has one, and never duplicates a unique id", () => {
    const users = [
      { id: 1, github_user_id: null },
      { id: 2, github_user_id: "5" },
      { id: 3, github_user_id: null },
    ];
    const result = backfillGithubUserIds(users, [
      { userId: 1, githubUserId: 5 },
      { userId: 3, githubUserId: 6 },
      { userId: 9, githubUserId: 1 },
    ]);
    expect(result.users.map((user) => user.github_user_id)).toEqual([null, "5", "6"]);
    expect(users[0].github_user_id).toBeNull();
  });
});

describe("activeRunsDecision", () => {
  it("proceeds without runs or with --yes, asks at a terminal, refuses otherwise", () => {
    expect(activeRunsDecision({ count: 0, yes: false, interactive: false })).toBe("proceed");
    expect(activeRunsDecision({ count: 2, yes: true, interactive: false })).toBe("proceed");
    expect(activeRunsDecision({ count: 2, yes: false, interactive: true })).toBe("ask");
    expect(activeRunsDecision({ count: 2, yes: false, interactive: false })).toBe("refuse");
    expect(activeRunsWarning(1)).toContain("1 agent run is");
    expect(activeRunsWarning(3)).toContain("3 agent runs are");
  });
});

describe("parseArgs", () => {
  it("reads the flags and positional arguments", () => {
    expect(parseArgs(["--with-s3", "--yes", "--out", "x.tar.gz"])).toMatchObject({ withS3: true, yes: true, out: "x.tar.gz", help: false });
    expect(parseArgs(["--out=y.tar.gz"]).out).toBe("y.tar.gz");
    expect(parseArgs(["a.tar.gz", "--help"])).toMatchObject({ help: true, positional: ["a.tar.gz"] });
  });

  it("refuses unknown options and a missing --out value", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a file name/);
  });
});
