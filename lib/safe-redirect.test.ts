import { describe, expect, it } from "vitest";

import { isSafeRedirectPath } from "@/lib/safe-redirect";

describe("isSafeRedirectPath", () => {
  it("accepts same-origin paths", () => {
    for (const path of ["/", "/workspaces", "/dashboard/3/board?x=1#top"]) expect(isSafeRedirectPath(path)).toBe(true);
  });

  it("rejects anything that can leave the site", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "workspaces", ""]) {
      expect(isSafeRedirectPath(value)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 3, ["/a"], {}]) expect(isSafeRedirectPath(value)).toBe(false);
  });
});
