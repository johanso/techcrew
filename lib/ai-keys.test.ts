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
    expect(readSavedKey(row("openai", "ok:sk-1"), "openai", "account")).toBe("sk-1");
    expect(readSavedKey(row("openai", "v1.a.b.c"), "openai", "account")).toBeNull();
    expect(readSavedKey(undefined, "openai", "workspace")).toBeNull();
  });

  it("is no key when the only saved key is unreadable", () => {
    const rows = { account: [row("openai", "v1.a.b.c")], workspace: [] };
    expect(resolveKey(rows, "openai", null)).toBeNull();
  });

  it("falls through to the next source", () => {
    const rows = { account: [row("openai", "v1.a.b.c")], workspace: [row("openai", "ok:sk-ws")] };
    expect(resolveKey(rows, "openai", "sk-env")).toBe("sk-ws");
    expect(resolveKey({ account: rows.account, workspace: [] }, "openai", "sk-env")).toBe("sk-env");
  });

  it("leaves other providers alone", () => {
    const rows = { account: [row("openai", "v1.a.b.c"), row("anthropic", "ok:sk-ant")], workspace: [] };
    expect(resolveKey(rows, "anthropic", null)).toBe("sk-ant");
  });

  it("shows the provider as not connected", () => {
    const keys: AIKeys = { openai: resolveKey({ account: [row("openai", "bad")], workspace: [] }, "openai", null), anthropic: "sk-ant", openrouter: null };
    expect(keyStatus(keys)).toEqual({ openai: false, anthropic: true, openrouter: false });
  });
});

describe("keyInUse", () => {
  it("prefers the account's key, then the workspace's, then the server's", () => {
    expect(keyInUse({ account: "a", workspace: "w", environment: "e" })).toEqual({ source: "account", key: "a" });
    expect(keyInUse({ account: null, workspace: "w", environment: "e" })).toEqual({ source: "workspace", key: "w" });
    expect(keyInUse({ account: null, workspace: null, environment: "e" })).toEqual({ source: "environment", key: "e" });
  });

  it("is null with no key anywhere", () => {
    expect(keyInUse({ account: null, workspace: null, environment: null })).toBeNull();
  });
});
