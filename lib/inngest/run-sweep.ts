import "server-only";

import { inngest } from "@/lib/inngest/client";
import { sweepStaleRuns } from "@/lib/run-sweep";

/**
 * Every 5 minutes: ends runs left behind when TechTeam (the app or the Inngest Dev Server) stopped mid-run, so the
 * card can be run again (lib/run-sweep.ts).
 */
export const runSweep = inngest.createFunction(
  { id: "run-sweep", name: "Agents: end interrupted runs" },
  { cron: "*/5 * * * *" },
  async ({ step }) => step.run("sweep", async () => ({ ended: await sweepStaleRuns() }))
);
