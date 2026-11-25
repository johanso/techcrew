import "server-only";

import { eq } from "drizzle-orm";

import { db, workspaces } from "@/db";
import { inngest } from "@/lib/inngest/client";
import type { LibrarianRequest } from "@/lib/memory-proposals";

/**
 * Asking for a librarian run: events for the job runner (lib/inngest/memory-librarian.ts). Nothing here throws into a
 * pipeline, a sync or an action: a request that can't be sent costs a warning, and "Learn now" reports it.
 */

/** A run to make now (one at a time per workspace). */
export const MEMORY_LEARN = "memory/learn.requested";
/** Something worth learning from happened: debounced, then turned into a MEMORY_LEARN request. */
export const MEMORY_LEARN_AUTO = "memory/learn.auto";

// A job runner that doesn't answer must not hold up the merge or the form that asked.
const SEND_TIMEOUT_MS = 4_000;

type LibrarianEvent = { name: typeof MEMORY_LEARN; data: LibrarianRequest } | { name: typeof MEMORY_LEARN_AUTO; data: { workspaceId: number } };

/** Sends one event; false, with a warning, when the job runner can't be reached. */
export async function sendLibrarianEvent(event: LibrarianEvent) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("no answer in time")), SEND_TIMEOUT_MS);
    });
    await Promise.race([inngest.send(event), timeout]);
    return true;
  } catch (error) {
    console.warn(`[librarian] couldn't reach the job runner: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * After a pull request is merged or closed, or the owner says why or asks to remember something: asks for an automatic
 * run, unless the workspace's memory or its automatic learning is off. Whether it then runs is learnDecision's.
 */
export async function requestLearning(workspaceId: number) {
  try {
    const [workspace] = await db
      .select({ mode: workspaces.memoryMode, autoLearn: workspaces.memoryAutoLearn })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!workspace || workspace.mode === "off" || !workspace.autoLearn) return;
    await sendLibrarianEvent({ name: MEMORY_LEARN_AUTO, data: { workspaceId } });
  } catch (error) {
    console.warn(`[librarian] couldn't ask for a run: ${error instanceof Error ? error.name : "unknown error"}`);
  }
}
