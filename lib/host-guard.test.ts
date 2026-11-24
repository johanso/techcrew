import { describe, expect, it } from "vitest";

import { hostnameOf, isAllowedHost } from "@/lib/host-guard";

describe("isAllowedHost", () => {
  it("accepts the loopback names, with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3999", "[::1]", "[::1]:3000"]) {
      expect(isAllowedHost(host), host).toBe(true);
    }
  });

  it("ignores case and a trailing dot", () => {
    for (const host of ["LOCALHOST:3000", "LocalHost", "localhost.", "localhost.:3000", "127.0.0.1."]) {
      expect(isAllowedHost(host), host).toBe(true);
    }
  });

  it("rejects other names, also ones that merely contain or start with an allowed name", () => {
    for (const host of [
      "evil.example",
      "evil.example:3000",
      "localhost.evil.example",
      "evil-localhost",
      "127.0.0.1.evil.example",
      "127.0.0.2",
      "0.0.0.0",
      "[::2]",
      "app.localhost",
    ]) {
      expect(isAllowedHost(host), host).toBe(false);
    }
  });

  it("rejects a missing or malformed Host", () => {
    for (const host of [null, undefined, "", "   ", "localhost@evil.example", "evil.example/localhost", "localhost:abc", "local host", "localhost:3000:1", "[::1"]) {
      expect(isAllowedHost(host), String(host)).toBe(false);
    }
  });

  it("also accepts the host of NEXT_PUBLIC_APP_URL, any port", () => {
    const appUrl = "https://techteam.example.com";
    expect(isAllowedHost("techteam.example.com", appUrl)).toBe(true);
    expect(isAllowedHost("TechTeam.Example.com:8443", appUrl)).toBe(true);
    expect(isAllowedHost("evil.example", appUrl)).toBe(false);
    expect(isAllowedHost("techteam.example.com", undefined)).toBe(false);
  });

  it("ignores a broken or empty NEXT_PUBLIC_APP_URL", () => {
    expect(isAllowedHost("techteam.example.com", "not a url")).toBe(false);
    expect(isAllowedHost("techteam.example.com", "")).toBe(false);
    expect(isAllowedHost("localhost:3000", "not a url")).toBe(true);
  });
});

describe("hostnameOf", () => {
  it("strips the port and keeps IPv6 brackets", () => {
    expect(hostnameOf("Example.com:8080")).toBe("example.com");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
    expect(hostnameOf("example.com.")).toBe("example.com");
    expect(hostnameOf(".")).toBeNull();
  });
});
