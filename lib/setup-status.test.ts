import { describe, expect, it } from "vitest";

import { setupPending, setupSteps, type AiRoute, type SetupFacts } from "@/lib/setup-status";

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ workspaceId: 7, ownsWorkspace: true, aiRoute: "key", ...over });
const byId = (f: SetupFacts) => Object.fromEntries(setupSteps(f).map((s) => [s.id, s]));

describe("setupSteps", () => {
  it("lists sign-in, the AI route and the workspace, in that order", () => {
    expect(setupSteps(facts()).map((s) => s.id)).toEqual(["sign-in", "ai-route", "workspace"]);
  });

  it("always counts sign-in as done", () => {
    expect(byId(facts({ aiRoute: null, ownsWorkspace: false, workspaceId: null }))["sign-in"]).toMatchObject({ done: true, href: null });
  });

  it.each<AiRoute>(["key", "plan", "simulated"])("counts a %s route as done, with nowhere left to go", (aiRoute) => {
    expect(byId(facts({ aiRoute }))["ai-route"]).toMatchObject({ done: true, href: null });
  });

  it("sends a missing AI route to Settings → AI of the workspace", () => {
    expect(byId(facts({ aiRoute: null, workspaceId: 7 }))["ai-route"]).toMatchObject({ done: false, href: "/dashboard/7/settings#ai" });
  });

  it("has no link for the AI route before a workspace exists, and says where to find it later", () => {
    const step = byId(facts({ aiRoute: null, workspaceId: null, ownsWorkspace: false }))["ai-route"]!;
    expect(step).toMatchObject({ done: false, href: null });
    expect(step.description).toContain("Settings → AI");
    expect(step.description).toContain("created your workspace");
  });

  it("asks for the first workspace only while the user owns none", () => {
    expect(byId(facts({ ownsWorkspace: false, workspaceId: null }))["workspace"]).toMatchObject({ done: false, href: "/workspaces/new" });
    expect(byId(facts())["workspace"]).toMatchObject({ done: true, href: null });
  });
});

describe("setupPending", () => {
  it.each([
    [{ aiRoute: "key", ownsWorkspace: true }, false],
    [{ aiRoute: "plan", ownsWorkspace: true }, false],
    [{ aiRoute: null, ownsWorkspace: true }, true],
    [{ aiRoute: "key", ownsWorkspace: false, workspaceId: null }, true],
    [{ aiRoute: null, ownsWorkspace: false, workspaceId: null }, true],
  ] as [Partial<SetupFacts>, boolean][])("%j -> %s", (over, expected) => {
    expect(setupPending(setupSteps(facts(over)))).toBe(expected);
  });
});
