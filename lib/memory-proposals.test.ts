import { describe, expect, it } from "vitest";

import {
  PENDING_PROPOSALS_MAX,
  QUEUED_STALE_MS,
  RUNNING_STALE_MS,
  currentLibrarianState,
  deliveryOf,
  learnDecision,
  librarianBusy,
  type LearnFacts,
  type LibrarianState,
} from "@/lib/memory-proposals";

const facts = (over: Partial<LearnFacts> = {}): LearnFacts => ({ trigger: "auto", mode: "repo", autoLearn: true, unconsumed: 3, trusted: 0, pending: 0, ...over });

describe("when the librarian learns", () => {
  it("runs on its own with three new signals, or a single one the owner typed", () => {
    expect(learnDecision(facts())).toEqual({ run: true });
    expect(learnDecision(facts({ unconsumed: 2 })).run).toBe(false);
    expect(learnDecision(facts({ unconsumed: 1, trusted: 1 }))).toEqual({ run: true });
  });

  it("never runs on its own with automatic learning off, memory off or a full inbox", () => {
    expect(learnDecision(facts({ autoLearn: false, trusted: 5 })).run).toBe(false);
    expect(learnDecision(facts({ mode: "off", trusted: 5 })).run).toBe(false);
    expect(learnDecision(facts({ pending: PENDING_PROPOSALS_MAX, trusted: 1 })).run).toBe(false);
    expect(learnDecision(facts({ pending: PENDING_PROPOSALS_MAX - 1 })).run).toBe(true);
  });

  it("Learn now takes any unused signal, but not with memory off or nothing new", () => {
    expect(learnDecision(facts({ trigger: "manual", unconsumed: 1, autoLearn: false, pending: 99 }))).toEqual({ run: true });
    expect(learnDecision(facts({ trigger: "manual", unconsumed: 0 })).run).toBe(false);
    expect(learnDecision(facts({ trigger: "manual", mode: "off" })).run).toBe(false);
  });
});

describe("delivery", () => {
  it("accepts on the page the owner's notes and local project notes, sends repository notes in a pull request", () => {
    expect(deliveryOf("global", "repo")).toBe("inbox");
    expect(deliveryOf("global", "local")).toBe("inbox");
    expect(deliveryOf("project", "local")).toBe("inbox");
    expect(deliveryOf("project", "repo")).toBe("pull_request");
    expect(deliveryOf("project", "off")).toBeNull();
    expect(deliveryOf("global", "off")).toBeNull();
  });
});

describe("the librarian's state", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const state = (kind: LibrarianState["state"], age: number): LibrarianState => ({
    state: kind,
    job: "learn",
    trigger: "manual",
    at: new Date(now.getTime() - age).toISOString(),
    message: "",
    proposals: 0,
    costMicros: 0,
  });

  it("stays busy while a request or a run is recent", () => {
    expect(librarianBusy(currentLibrarianState(state("queued", 1000), now))).toBe(true);
    expect(librarianBusy(currentLibrarianState(state("running", RUNNING_STALE_MS - 1000), now))).toBe(true);
  });

  it("reads a request never picked up, or a run cut off, as failed", () => {
    expect(currentLibrarianState(state("queued", QUEUED_STALE_MS), now)).toMatchObject({ state: "failed", message: expect.stringContaining("Inngest") });
    expect(currentLibrarianState(state("running", RUNNING_STALE_MS), now)).toMatchObject({ state: "failed" });
    expect(librarianBusy(currentLibrarianState(state("running", RUNNING_STALE_MS), now))).toBe(false);
  });

  it("leaves finished states and no state alone", () => {
    const done = state("done", 10 * RUNNING_STALE_MS);
    expect(currentLibrarianState(done, now)).toBe(done);
    expect(currentLibrarianState(null, now)).toBeNull();
  });
});
