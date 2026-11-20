import { describe, expect, it } from "vitest";

import {
  accountMatches,
  cliAgentsAllowed,
  cliForModel,
  defaultPlanLimitPolicy,
  describeAccount,
  formatTokens,
  parseCliAuth,
  parseRunWaiting,
  planIncludesModel,
  planLimitAction,
  planUsageSummary,
  resolveRoute,
  type CliAuth,
  type CliMachineState,
} from "@/lib/cli-agents-config";

const auth = (over: Partial<CliAuth> = {}): CliAuth => ({
  loggedIn: true,
  authMethod: "claude.ai",
  email: "me@example.com",
  orgName: null,
  subscriptionType: "max",
  loginExpiresAt: null,
  ...over,
});

const machine = (over: Partial<CliMachineState> = {}): CliMachineState => ({
  installed: true,
  enabled: true,
  auth: auth(),
  confirmed: { email: "me@example.com", orgName: null },
  unusable: [],
  limitedUntil: null,
  ...over,
});

const NOW = new Date("2026-11-20T12:00:00Z");

describe("cliAgentsAllowed", () => {
  it("allows a local checkout without any variable", () => {
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe(true);
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" })).toBe(true);
  });

  it("refuses hosted platforms, public URLs, a missing URL and the kill switch", () => {
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", VERCEL: "1" })).toBe(false);
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "https://techteam.example.com" })).toBe(false);
    expect(cliAgentsAllowed({})).toBe(false);
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", AGENTS_LOCAL_CLI: "false" })).toBe(false);
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", AGENTS_LOCAL_CLI: " FALSE " })).toBe(false);
  });

  it("ignores a kill switch set to anything but false", () => {
    expect(cliAgentsAllowed({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", AGENTS_LOCAL_CLI: "true" })).toBe(true);
  });
});

describe("parseCliAuth", () => {
  it("reads claude auth status --json", () => {
    const parsed = parseCliAuth(
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "me@example.com", orgName: "Personal", subscriptionType: "Max", loginExpiresAt: 1795000000000 })
    );
    expect(parsed).toMatchObject({ loggedIn: true, email: "me@example.com", orgName: "Personal", subscriptionType: "max" });
    expect(parsed.loginExpiresAt).toBe(new Date(1795000000000).toISOString());
  });

  it("treats a signed-out or unreadable status as signed out", () => {
    expect(parseCliAuth('{"loggedIn":false,"authMethod":"none","loginExpiresAt":null}')).toMatchObject({ loggedIn: false, email: null, subscriptionType: null });
    expect(parseCliAuth("not json").loggedIn).toBe(false);
  });
});

describe("accountMatches", () => {
  it("needs the same email and organization", () => {
    expect(accountMatches(auth(), { email: "ME@example.com", orgName: null })).toBe(true);
    expect(accountMatches(auth({ orgName: "Employer Inc" }), { email: "me@example.com", orgName: null })).toBe(false);
    expect(accountMatches(auth({ email: "me@work.com" }), { email: "me@example.com", orgName: null })).toBe(false);
    expect(accountMatches(auth(), null)).toBe(false);
    expect(accountMatches(auth({ loggedIn: false }), { email: "me@example.com", orgName: null })).toBe(false);
  });

  it("describes the account for the owner", () => {
    expect(describeAccount(auth({ orgName: "Personal", subscriptionType: "pro" }))).toBe("me@example.com · Personal · Pro");
  });
});

describe("planIncludesModel", () => {
  it("keeps Opus off Claude Pro", () => {
    expect(planIncludesModel("pro", "claude-opus-5-5")).toBe(false);
    expect(planIncludesModel("pro", "claude-sonnet-5-5")).toBe(true);
    expect(planIncludesModel("max", "claude-opus-5-5")).toBe(true);
    expect(planIncludesModel(null, "claude-sonnet-5-5")).toBe(false);
  });
});

describe("resolveRoute", () => {
  it("routes Claude models through the plan when everything holds", () => {
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: false, cli: machine(), now: NOW })).toEqual({ route: "claude-plan", billing: "plan", note: null });
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: true, cli: machine(), now: NOW })).toMatchObject({ route: "claude-plan" });
  });

  it("never routes OpenAI or OpenRouter models through Claude Code", () => {
    expect(cliForModel("gpt-6.1-sol")).toBeNull();
    expect(cliForModel("deepseek/deepseek-v4-pro-0813")).toBeNull();
    expect(resolveRoute({ model: "gpt-6.1-sol", hasKey: true, cli: machine(), now: NOW })).toMatchObject({ route: "api", billing: "api" });
    expect(resolveRoute({ model: "deepseek/deepseek-v4-pro-0813", hasKey: false, cli: machine(), now: NOW })).toMatchObject({ route: null });
  });

  const fallbacks: [string, Partial<CliMachineState>][] = [
    ["switched off", { enabled: false }],
    ["not installed", { installed: false }],
    ["signed out", { auth: auth({ loggedIn: false }) }],
    ["an API-key login", { auth: auth({ authMethod: "api_key", subscriptionType: null }) }],
    ["another account", { auth: auth({ email: "me@work.com", orgName: "Employer Inc" }) }],
    ["no confirmed account", { confirmed: null }],
    ["a model the CLI refused", { unusable: ["claude-sonnet-5-5"] }],
    ["an exhausted window", { limitedUntil: "2026-11-20T15:40:00Z" }],
  ];

  it.each(fallbacks)("falls back to the API key when %s", (_, over) => {
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: true, cli: machine(over), now: NOW })).toMatchObject({ route: "api", billing: "api" });
  });

  it.each(fallbacks)("refuses with a fix when %s and there's no key", (_, over) => {
    const resolved = resolveRoute({ model: "claude-sonnet-5-5", hasKey: false, cli: machine(over), now: NOW });
    expect(resolved.route).toBeNull();
    expect("problem" in resolved && resolved.problem).toMatch(/Settings/);
  });

  it("notes why a switched-on plan wasn't used", () => {
    const resolved = resolveRoute({ model: "claude-opus-5-5", hasKey: true, cli: machine({ auth: auth({ subscriptionType: "pro" }) }), now: NOW });
    expect(resolved).toMatchObject({ route: "api", note: expect.stringContaining("doesn't include Claude Opus 5.5") });
  });

  it("uses the plan again once the window has reset", () => {
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: true, cli: machine({ limitedUntil: "2026-11-20T11:00:00Z" }), now: NOW })).toMatchObject({ route: "claude-plan" });
  });

  it("keeps a stage on the API key after it moved there", () => {
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: true, cli: machine(), now: NOW, forceApi: true })).toMatchObject({ route: "api" });
  });

  it("without CLI state behaves as before: key or a problem", () => {
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: true, cli: null })).toMatchObject({ route: "api" });
    expect(resolveRoute({ model: "claude-sonnet-5-5", hasKey: false, cli: null })).toMatchObject({ route: null, problem: expect.stringContaining("Anthropic API key") });
  });
});

describe("planLimitAction", () => {
  const base = { hasKey: true, other: "openrouter" as const, resetsAt: "2026-11-20T15:40:00Z", now: NOW };

  it("defaults to the key when there is one, else to waiting", () => {
    expect(defaultPlanLimitPolicy(true)).toBe("api");
    expect(defaultPlanLimitPolicy(false)).toBe("wait");
  });

  it("waits until a minute after the reset", () => {
    expect(planLimitAction({ ...base, policy: "wait" })).toEqual({ kind: "wait", until: "2026-11-20T15:41:00.000Z" });
  });

  it("retries in 30 minutes when the CLI gives no reset time", () => {
    expect(planLimitAction({ ...base, policy: "wait", resetsAt: null })).toEqual({ kind: "wait", until: "2026-11-20T12:31:00.000Z" });
  });

  it("continues on the key, or fails over, when chosen and possible", () => {
    expect(planLimitAction({ ...base, policy: "api" })).toEqual({ kind: "api" });
    expect(planLimitAction({ ...base, policy: "failover" })).toEqual({ kind: "failover" });
  });

  it("waits when the chosen action isn't possible", () => {
    expect(planLimitAction({ ...base, policy: "api", hasKey: false })).toMatchObject({ kind: "wait" });
    expect(planLimitAction({ ...base, policy: "failover", other: null })).toMatchObject({ kind: "wait" });
  });

  it("doesn't hold a card for a weekly limit: the key, else a stop", () => {
    const far = { ...base, policy: "wait" as const, resetsAt: "2026-11-24T12:00:00Z" };
    expect(planLimitAction(far)).toEqual({ kind: "api" });
    expect(planLimitAction({ ...far, hasKey: false })).toMatchObject({ kind: "stop" });
  });
});

describe("parseRunWaiting", () => {
  it("reads a stored wait and rejects anything else", () => {
    expect(parseRunWaiting({ kind: "plan_limit", cli: "claude", until: "2026-11-20T15:41:00Z" })).toEqual({ kind: "plan_limit", cli: "claude", until: "2026-11-20T15:41:00Z" });
    expect(parseRunWaiting({ kind: "plan_limit", cli: "codex", until: "x" })).toBeNull();
    expect(parseRunWaiting(null)).toBeNull();
  });
});

describe("planUsageSummary", () => {
  it("shows turns, tokens and the API-equivalent cost as a reference", () => {
    expect(planUsageSummary({ turns: 12, tokens: 180_400, equivalentMicros: 401_234 })).toBe("Your Claude plan · 12 turns · 180K tokens (≈ $0.40 at API prices)");
    expect(planUsageSummary({ turns: 1, tokens: 900, equivalentMicros: 0 })).toBe("Your Claude plan · 1 turn · 900 tokens");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(12_500_000)).toBe("13M");
  });
});
