import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { seal, signSession, unseal, verifySession } from "@/lib/session";

const secret = Buffer.alloc(32, 7);
const now = 1_800_000_000_000;
const later = now + 60_000;

describe("signSession / verifySession", () => {
  it("round-trips a user id", () => {
    expect(verifySession(signSession(42, later, secret), secret, now)).toBe(42);
  });

  it("has the shape <userId>.<expiresAtMs>.<hmac>", () => {
    const [id, expires, mac] = signSession(42, later, secret).split(".");
    expect(id).toBe("42");
    expect(expires).toBe(String(later));
    expect(mac).toMatch(/^[\w-]{43}$/);
  });

  it("rejects a changed user id, a changed expiry and a changed signature", () => {
    const [id, expires, mac] = signSession(42, later, secret).split(".");
    expect(verifySession(`43.${expires}.${mac}`, secret, now)).toBeNull();
    expect(verifySession(`${id}.${later + 1}.${mac}`, secret, now)).toBeNull();
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(verifySession(`${id}.${expires}.${flipped}`, secret, now)).toBeNull();
    expect(verifySession(`${id}.${expires}.`, secret, now)).toBeNull();
  });

  it("rejects a value signed with another secret", () => {
    expect(verifySession(signSession(42, later, randomBytes(32)), secret, now)).toBeNull();
  });

  it("rejects an expired session, also at the exact expiry", () => {
    expect(verifySession(signSession(42, now - 1, secret), secret, now)).toBeNull();
    expect(verifySession(signSession(42, now, secret), secret, now)).toBeNull();
  });

  it("rejects malformed values without throwing", () => {
    for (const value of [undefined, "", "abc", "1.2", "1.2.3.4", "..", `.${later}.x`, `1.${"9".repeat(40)}.x`, "1.-5.x", "1.1e9.x"]) {
      expect(verifySession(value, secret, now)).toBeNull();
    }
  });

  it("rejects a signature of another length before comparing (the constant-time path needs equal lengths)", () => {
    const [id, expires] = signSession(42, later, secret).split(".");
    expect(verifySession(`${id}.${expires}.short`, secret, now)).toBeNull();
    expect(verifySession(`${id}.${expires}.${"A".repeat(200)}`, secret, now)).toBeNull();
  });

  it("only accepts positive integer ids", () => {
    expect(verifySession(seal("0", later, secret), secret, now)).toBeNull();
    expect(verifySession(seal("-1", later, secret), secret, now)).toBeNull();
    expect(verifySession(seal("4.5", later, secret), secret, now)).toBeNull();
    expect(verifySession(seal("eyJhIjoxfQ", later, secret), secret, now)).toBeNull();
  });
});

describe("seal / unseal", () => {
  it("returns the payload of a valid value", () => {
    expect(unseal(seal("abc_DEF-1", later, secret), secret, now)).toBe("abc_DEF-1");
  });

  it("rejects a forged or expired value", () => {
    expect(unseal(seal("abc", later, secret).replace("abc", "abd"), secret, now)).toBeNull();
    expect(unseal(seal("abc", now - 5, secret), secret, now)).toBeNull();
  });
});
