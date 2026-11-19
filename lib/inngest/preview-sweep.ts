import "server-only";

import { inngest } from "@/lib/inngest/client";
import { sweepPreviews } from "@/lib/sandbox/preview";

/**
 * Every 10 minutes: stops previews older than two hours and removes what the sandbox host still holds for runs
 * whose preview already ended (lib/sandbox/preview.ts). Does nothing on a server without a sandbox host.
 */
export const previewSweep = inngest.createFunction(
  { id: "preview-sweep", name: "Sandbox: stop old previews" },
  { cron: "*/10 * * * *" },
  async ({ step }) => step.run("sweep", () => sweepPreviews())
);
