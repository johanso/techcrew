import "server-only";

import { inngest } from "@/lib/inngest/client";
import { runLibrarian } from "@/lib/librarian-run";
import { MEMORY_LEARN, MEMORY_LEARN_AUTO } from "@/lib/librarian-request";
import { parseLibrarianRequest } from "@/lib/memory-proposals";

/**
 * Automatic requests wait until a workspace has been quiet for a few minutes (a merge, its rejection and a note arrive
 * together), then become one run. "Learn now" and the bootstrap don't pass through here, so they don't wait.
 */
export const memoryLibrarianAuto = inngest.createFunction(
  { id: "memory-librarian-auto", name: "Brain: wait for signals to settle", debounce: { key: "event.data.workspaceId", period: "3m", timeout: "15m" } },
  { event: MEMORY_LEARN_AUTO },
  async ({ event, step }) => {
    const request = parseLibrarianRequest({ workspaceId: event.data?.workspaceId, job: "learn", trigger: "auto" });
    if (!request) return { skipped: "Not a request." };
    await step.sendEvent("learn", { name: MEMORY_LEARN, data: request });
    return { requested: request.workspaceId };
  }
);

/**
 * The librarian: one run at a time per workspace, in a single step. No retries: a retry would pay for the model again,
 * and a failed run leaves its signals unused for the next one.
 */
export const memoryLibrarian = inngest.createFunction(
  { id: "memory-librarian", name: "Brain: librarian", concurrency: { limit: 1, key: "event.data.workspaceId" }, retries: 0 },
  { event: MEMORY_LEARN },
  async ({ event, step }) => {
    const request = parseLibrarianRequest(event.data);
    if (!request) return { skipped: "Not a request." };
    return step.run("run", () => runLibrarian(request));
  }
);
