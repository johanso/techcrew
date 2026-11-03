import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { agentAutoPickup } from '@/lib/inngest/agent-pickup';
import { agentTaskRun } from '@/lib/inngest/agent-run';
import {
  processTaskBackgroundJob,
  dailySyncScheduledJob,
} from '@/lib/inngest/functions';

// Create an API route that serves Inngest functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processTaskBackgroundJob,
    dailySyncScheduledJob,
    agentTaskRun,
    agentAutoPickup,
  ],
});
