import { Inngest } from 'inngest';

// Inngest Cloud is only used when its keys are set. Without them this is a local install, whose Dev Server must be
// used under `next start` too: the SDK would otherwise infer cloud mode from NODE_ENV=production and never reach it.
const usesCloud = Boolean(process.env.INNGEST_EVENT_KEY?.trim() || process.env.INNGEST_SIGNING_KEY?.trim());

// Create an Inngest client to send and receive events
export const inngest = new Inngest({
  id: 'fastnext-app',
  eventKey: process.env.INNGEST_EVENT_KEY,
  isDev: usesCloud ? undefined : true,
});
