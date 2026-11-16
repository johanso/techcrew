import "server-only";

import { inngest } from "@/lib/inngest/client";
import { requestSwitchScans, weeklyScanWorkspaces } from "@/lib/switch-trust";

/**
 * Weekly SwitchAgent scans (Settings → Switch Trust → Scan every week): Mondays 06:00 UTC, one scan per agent of
 * every connected workspace that has it on. Only queues them; Cloudhike jobs do the work (lib/switch-trust.ts).
 */
export const switchWeeklyScans = inngest.createFunction(
  { id: "switch-weekly-scans", name: "Switch Trust: weekly scans" },
  { cron: "0 6 * * 1" },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () => weeklyScanWorkspaces());
    let queued = 0;
    for (const workspaceId of workspaceIds) {
      // One step per workspace: a retry doesn't queue the others twice.
      const result = await step.run(`scan-workspace-${workspaceId}`, () =>
        requestSwitchScans({ workspaceId, trigger: "scheduled", userId: null })
      );
      if (result.ok) queued += result.queued;
    }
    return { workspaces: workspaceIds.length, queued };
  }
);
