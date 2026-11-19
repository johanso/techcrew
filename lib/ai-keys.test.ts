import { describe, expect, it } from "vitest";

import { keyInUse } from "@/lib/ai-keys";

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
