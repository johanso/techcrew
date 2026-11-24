import { describe, expect, it, vi } from "vitest";

// Readable rows hold "ok:<key>"; anything else is unreadable, as after the encryption key changed.
vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `ok:${value}`,
  tryDecrypt: (value: string) => (value.startsWith("ok:") ? value.slice(3) : null),
  warnUnreadable: () => undefined,
}));

import { keyInUse, keyStatus, readSavedKey, resolveKey, type AIKeys } from "@/lib/ai-keys";

const row = (provider: string, apiKey: string) => ({ provider, apiKey, hint: "h", updatedAt: new Date(0) });

describe("unreadable saved keys", () => {
  it("reads a readable row and treats an unreadable or absent one as missing", () => {
    expect(readSavedKey(row("openai", "ok:sk-1"), "openai")).toBe("sk-1");
    expect(readSavedKey(row("openai", "v1.a.b.c"), "openai")).toBeNull();
    expect(readSavedKey(undefined, "openai")).toBeNull();
  });

  it("is no key when the only saved key is unreadable", () => {
    expect(resolveKey([row("openai", "v1.a.b.c")], "openai", null)).toBeNull();
  });

  it("falls through to the environment's key", () => {
    expect(resolveKey([row("openai", "v1.a.b.c")], "openai", "sk-env")).toBe("sk-env");
    expect(resolveKey([row("openai", "ok:sk-acct")], "openai", "sk-env")).toBe("sk-acct");
  });

  it("leaves other providers alone", () => {
    const rows = [row("openai", "v1.a.b.c"), row("anthropic", "ok:sk-ant")];
    expect(resolveKey(rows, "anthropic", null)).toBe("sk-ant");
  });

  it("shows the provider as not connected", () => {
    const keys: AIKeys = { openai: resolveKey([row("openai", "bad")], "openai", null), anthropic: "sk-ant", openrouter: null };
    expect(keyStatus(keys)).toEqual({ openai: false, anthropic: true, openrouter: false });
  });
});

describe("keyInUse", () => {
  it("prefers the account's key, then the environment's", () => {
    expect(keyInUse({ account: "a", environment: "e" })).toEqual({ source: "account", key: "a" });
    expect(keyInUse({ account: null, environment: "e" })).toEqual({ source: "environment", key: "e" });
  });

  it("is null with no key anywhere", () => {
    expect(keyInUse({ account: null, environment: null })).toBeNull();
  });
});
