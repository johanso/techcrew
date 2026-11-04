import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agentAutoPickup } from "@/lib/inngest/agent-pickup";
import { agentTaskRun } from "@/lib/inngest/agent-run";

// Serves the agent pipeline and the auto-pickup cron to Inngest (Dev Server locally, Inngest Cloud in production).
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agentTaskRun, agentAutoPickup],
});
