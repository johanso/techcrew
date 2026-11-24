import { describe, expect, it } from "vitest";

import { STALE_RUN_MS, interruptedNotice, isStaleRun, latestOf } from "@/lib/run-recovery-config";

const now = new Date("2026-11-24T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;

describe("isStaleRun", () => {
  const run = (status: string, updatedAt: Date, waiting: unknown = null) => ({ status, waiting, updatedAt });

  it("flags a queued or running run with no sign of life for over 30 minutes", () => {
    expect(isStaleRun(run("running", ago(2 * 60 * MIN)), null, now)).toBe(true);
    expect(isStaleRun(run("queued", ago(31 * MIN)), null, now)).toBe(true);
  });

  it("leaves a fresh run alone, and the boundary itself", () => {
    expect(isStaleRun(run("running", ago(5 * MIN)), null, now)).toBe(false);
    expect(isStaleRun(run("running", ago(STALE_RUN_MS)), null, now)).toBe(false);
    expect(isStaleRun(run("running", ago(STALE_RUN_MS + 1)), null, now)).toBe(true);
  });

  it("counts the newest of the run's update and its log or activity", () => {
    const old = ago(2 * 60 * MIN);
    expect(isStaleRun(run("running", old), ago(3 * MIN), now)).toBe(false);
    expect(isStaleRun(run("running", ago(3 * MIN)), old, now)).toBe(false);
    expect(isStaleRun(run("running", old), ago(90 * MIN), now)).toBe(true);
  });

  it("never touches a run paused for the owner's plan", () => {
    expect(isStaleRun(run("running", ago(5 * 60 * MIN), { kind: "plan_limit", cli: "claude", until: "2026-11-24T15:00:00Z" }), null, now)).toBe(false);
  });

  it("never touches runs that wait on a person or are over", () => {
    for (const status of ["needs_info", "awaiting_merge", "cancelled", "failed", "completed", "something_else"]) {
      expect(isStaleRun(run(status, ago(5 * 60 * MIN)), null, now)).toBe(false);
    }
  });
});

describe("latestOf", () => {
  it("picks the newest time and skips missing ones", () => {
    expect(latestOf(null, ago(10 * MIN), undefined, ago(2 * MIN))?.getTime()).toBe(ago(2 * MIN).getTime());
    expect(latestOf(null, undefined)).toBeNull();
  });
});

describe("interruptedNotice", () => {
  it("names the card and tells the owner what to do", () => {
    const notice = interruptedNotice("ROA-2");
    expect(notice.title).toBe("Run interrupted on ROA-2");
    expect(notice.body).toBe("The run on ROA-2 was interrupted when TechTeam stopped. Press Run to continue: it picks up the same branch.");
  });
});
