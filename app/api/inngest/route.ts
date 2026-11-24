import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agentAutoPickup } from "@/lib/inngest/agent-pickup";
import { agentTaskRun } from "@/lib/inngest/agent-run";
import { previewSweep } from "@/lib/inngest/preview-sweep";

// Serves the agent pipeline and the auto-pickup, preview sweep crons to Inngest (Dev Server locally, Inngest Cloud in production).
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agentTaskRun, agentAutoPickup, previewSweep],
});
