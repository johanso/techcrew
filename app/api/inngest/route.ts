import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agentAutoPickup } from "@/lib/inngest/agent-pickup";
import { agentTaskRun } from "@/lib/inngest/agent-run";
import { switchWeeklyScans } from "@/lib/inngest/switch-weekly";

// Serves the agent pipeline and the auto-pickup and weekly Switch crons to Inngest (Dev Server locally, Inngest Cloud in production).
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agentTaskRun, agentAutoPickup, switchWeeklyScans],
});
