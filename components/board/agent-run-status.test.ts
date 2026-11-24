import { describe, expect, it } from "vitest";

import { runStatusMeta } from "@/components/board/agent-run-status";
import type { BoardCardRun } from "@/lib/agent-run-config";
import { INTERRUPTED_LABEL } from "@/lib/run-recovery-config";

const failed = (failure: BoardCardRun["failure"]): BoardCardRun => ({
  id: 1,
  status: "failed",
  stage: "development",
  error: null,
  failure,
  pullRequest: null,
  ci: null,
  preview: null,
  waiting: null,
});

describe("runStatusMeta for failed runs", () => {
  it("labels an interrupted run, not as a generic stop", () => {
    expect(runStatusMeta(failed({ kind: "interrupted" })).label).toBe(INTERRUPTED_LABEL);
  });

  it("keeps the other failure labels", () => {
    expect(runStatusMeta(failed(null)).label).toBe("Agents stopped");
    expect(runStatusMeta(failed({ kind: "out_of_credit", provider: "openai" })).label).toMatch(/credit/);
  });
});
