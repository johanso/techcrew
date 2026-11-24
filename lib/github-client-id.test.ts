import { describe, expect, it } from "vitest";

import { DEFAULT_GITHUB_CLIENT_ID, resolveGithubClientId } from "@/lib/github-client-id";

describe("resolveGithubClientId", () => {
  it("uses the shipped default when the variable is unset or blank", () => {
    expect(resolveGithubClientId({})).toBe(DEFAULT_GITHUB_CLIENT_ID);
    expect(resolveGithubClientId({ GITHUB_CLIENT_ID: "   " })).toBe(DEFAULT_GITHUB_CLIENT_ID);
  });

  it("lets GITHUB_CLIENT_ID win, trimmed", () => {
    expect(resolveGithubClientId({ GITHUB_CLIENT_ID: " Ov23own " })).toBe("Ov23own");
  });

  it("is null only when there is no value at all (the page then shows the setup help)", () => {
    expect(resolveGithubClientId({}, "")).toBeNull();
    expect(resolveGithubClientId({ GITHUB_CLIENT_ID: "x" }, "")).toBe("x");
  });
});
