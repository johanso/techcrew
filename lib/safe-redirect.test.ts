import { describe, expect, it } from "vitest";

import { isSafeRedirectPath, reconnectHref, safeNext } from "@/lib/safe-redirect";

describe("isSafeRedirectPath", () => {
  it("accepts same-origin paths", () => {
    for (const path of ["/", "/workspaces", "/dashboard/3/board?x=1#top"]) expect(isSafeRedirectPath(path)).toBe(true);
  });

  it("rejects anything that can leave the site", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "workspaces", ""]) {
      expect(isSafeRedirectPath(value)).toBe(false);
    }
  });

  it("rejects what a browser would quietly turn into another site", () => {
    for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\t\\evil.example", "/ok\\..\\evil", "/\u0000/evil.example"]) {
      expect(isSafeRedirectPath(value)).toBe(false);
    }
  });

  it("keeps encoded slashes, which stay part of the path", () => {
    expect(isSafeRedirectPath("/%2F%2Fevil.example")).toBe(true);
    expect(new URL("/%2F%2Fevil.example", "http://localhost").origin).toBe("http://localhost");
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 3, ["/a"], {}]) expect(isSafeRedirectPath(value)).toBe(false);
  });
});

describe("safeNext", () => {
  it("keeps a safe path and replaces anything else with the workspace picker", () => {
    expect(safeNext("/settings")).toBe("/settings");
    for (const value of [undefined, null, ["/a"], "//evil.example"]) expect(safeNext(value)).toBe("/workspaces");
  });
});

describe("reconnectHref", () => {
  const params = (href: string) => new URL(href, "http://localhost").searchParams;

  it("points a signed-in owner at the sign-in page and back to where they were", () => {
    expect(reconnectHref("/dashboard/3/brain")).toBe("/sign-in?reconnect=1&next=%2Fdashboard%2F3%2Fbrain");
  });

  it("encodes the destination, so its own query and hash stay part of it", () => {
    const next = "/dashboard/3/board?x=1&reconnect=0#top";
    const query = params(reconnectHref(next));
    expect(query.get("next")).toBe(next);
    expect(query.getAll("reconnect")).toEqual(["1"]);
  });

  it("goes to the workspace picker without a destination or with an unsafe one", () => {
    for (const next of [undefined, "", "//evil.example", "https://evil.example"]) {
      expect(params(reconnectHref(next)).get("next")).toBe("/workspaces");
    }
  });
});
