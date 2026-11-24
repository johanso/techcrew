import { describe, expect, it } from "vitest";

import { authUserIdFor, noreplyEmail, resolveUser, type ConnectionRow, type GithubIdentity, type UserRow } from "@/lib/user-identity";

const me: GithubIdentity = { githubUserId: 1001, login: "octo-cat", name: "Octo Cat", avatarUrl: null };
const user = (id: number, githubUserId: number | null = null, email = `u${id}@example.com`): UserRow => ({ id, githubUserId, email });

describe("resolveUser", () => {
  it("a: a user with that GitHub id wins", () => {
    expect(resolveUser(me, [user(1), user(2, 1001)], [])).toEqual({ kind: "existing", userId: 2, link: false });
  });

  it("a: wins over a connection of another user", () => {
    expect(resolveUser(me, [user(1), user(2, 1001)], [{ userId: 1, githubUserId: 1001 }])).toEqual({ kind: "existing", userId: 2, link: false });
  });

  it("a: signs the right user in even when they are the only user", () => {
    expect(resolveUser(me, [user(5, 1001)], [])).toEqual({ kind: "existing", userId: 5, link: false });
  });

  it("b: a saved connection with that GitHub id links its user", () => {
    const connections: ConnectionRow[] = [{ userId: 2, githubUserId: 1001 }];
    expect(resolveUser(me, [user(1), user(2), user(3)], connections)).toEqual({ kind: "existing", userId: 2, link: true });
  });

  it("b: ignores a connection whose user already belongs to another GitHub account", () => {
    expect(resolveUser(me, [user(1, 999), user(2)], [{ userId: 1, githubUserId: 1001 }])).toEqual({ kind: "create" });
  });

  it("b: ignores a connection of a user that no longer exists", () => {
    expect(resolveUser(me, [user(1, 999), user(2, 998)], [{ userId: 77, githubUserId: 1001 }])).toEqual({ kind: "create" });
  });

  it("b: picks the oldest user when several connections carry the id", () => {
    const connections: ConnectionRow[] = [
      { userId: 3, githubUserId: 1001 },
      { userId: 2, githubUserId: 1001 },
    ];
    expect(resolveUser(me, [user(2), user(3)], connections)).toEqual({ kind: "existing", userId: 2, link: true });
  });

  it("b: beats the single-user adoption question", () => {
    expect(resolveUser(me, [user(1)], [{ userId: 1, githubUserId: 1001 }])).toEqual({ kind: "existing", userId: 1, link: true });
  });

  it("c: exactly one user without a GitHub id asks for confirmation", () => {
    expect(resolveUser(me, [user(1, null, "owner@example.com")], [])).toEqual({ kind: "confirm-adoption", userId: 1, email: "owner@example.com" });
  });

  it("c: a connection to a different GitHub account doesn't stop the question", () => {
    expect(resolveUser(me, [user(1)], [{ userId: 1, githubUserId: 555 }])).toEqual({ kind: "confirm-adoption", userId: 1, email: "u1@example.com" });
  });

  it("c: the only user already tied to another GitHub account is never offered", () => {
    expect(resolveUser(me, [user(1, 555)], [])).toEqual({ kind: "create" });
  });

  it("d: an empty database creates a user", () => {
    expect(resolveUser(me, [], [])).toEqual({ kind: "create" });
  });

  it("d: several users and no match create a user", () => {
    expect(resolveUser(me, [user(1), user(2)], [])).toEqual({ kind: "create" });
    expect(resolveUser(me, [user(1, 7), user(2, 8)], [{ userId: 1, githubUserId: 7 }])).toEqual({ kind: "create" });
  });

  it("two concurrent sign-ins that both saw an empty database resolve to create, and the second sees the first's row", () => {
    expect(resolveUser(me, [], [])).toEqual({ kind: "create" });
    expect(resolveUser(me, [user(1, 1001)], [])).toEqual({ kind: "existing", userId: 1, link: false });
  });

  it("a different GitHub account after the owner's adoption is a separate user", () => {
    const other: GithubIdentity = { githubUserId: 2002, login: "someone", name: null, avatarUrl: null };
    expect(resolveUser(other, [user(1, 1001)], [])).toEqual({ kind: "create" });
  });
});

describe("identity values", () => {
  it("builds GitHub's no-reply address from the id and login", () => {
    expect(noreplyEmail(me)).toBe("1001+octo-cat@users.noreply.github.com");
  });

  it("is unique per account even when two logins match after a rename", () => {
    expect(noreplyEmail({ githubUserId: 1, login: "same" })).not.toBe(noreplyEmail({ githubUserId: 2, login: "same" }));
  });

  it("marks the auth user id as GitHub's", () => {
    expect(authUserIdFor(1001)).toBe("github:1001");
  });
});
