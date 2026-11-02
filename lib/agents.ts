import "server-only";

/**
 * AI agents that work in a workspace.
 *
 * ⚠️ DUMMY DATA. There is no agents table yet; `listAgents` returns fixtures. Keep the `Agent`
 * shape when replacing it with a query.
 */

export type AgentTone = "brand" | "action" | "success" | "warning";
export type Agent = { id: string; name: string; role: string; tone: AgentTone };

export const DUMMY_AGENTS = {
  atlas: { id: "atlas", name: "Atlas", role: "Frontend engineer", tone: "brand" },
  nova: { id: "nova", name: "Nova", role: "Backend engineer", tone: "action" },
  sage: { id: "sage", name: "Sage", role: "QA engineer", tone: "success" },
  orion: { id: "orion", name: "Orion", role: "DevOps engineer", tone: "warning" },
} satisfies Record<string, Agent>;

export async function listAgents(): Promise<Agent[]> {
  return Object.values(DUMMY_AGENTS);
}

/** Short uppercase prefix for task keys, e.g. "Acme Platform" → "ACM". */
export function taskKeyPrefix(workspaceName: string) {
  return workspaceName.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "TSK";
}
