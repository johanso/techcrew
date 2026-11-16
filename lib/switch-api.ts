import "server-only";

import type { SwitchEvaluation, SwitchRun, SwitchRunResult, SwitchSummary } from "@/lib/switch-trust-config";

/**
 * Switch Trust REST API (https://docs.switchagents.ai/switch-trust/api-reference). Every call is scoped to the
 * connection's tenant and workspace. The key is passed in by lib/switch-trust.ts and never leaves the server.
 */

export type SwitchAuthScheme = "ApiKey" | "Bearer";

export type SwitchCredentials = {
  baseUrl: string;
  apiKey: string;
  scheme: SwitchAuthScheme;
  tenantId: string;
  workspaceId: string;
};

export class SwitchApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(
  creds: Pick<SwitchCredentials, "baseUrl" | "apiKey" | "scheme">,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `${creds.scheme} ${creds.apiKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    console.warn("[switch] request failed", method, path, error);
    throw new SwitchApiError(0, "We couldn't reach Switch Trust. Check the instance URL and try again.");
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof detail?.message === "string" ? detail.message : response.statusText;
    throw new SwitchApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** One message for users when Switch refuses, without echoing secrets. */
export function switchErrorMessage(error: unknown) {
  if (!(error instanceof SwitchApiError)) {
    console.error("[switch]", error);
    return "The Switch Trust request failed. Please try again.";
  }
  if (error.status === 0) return error.message;
  if (error.status === 401) return "Switch Trust rejected the API key. Check it in Settings → Switch Trust.";
  if (error.status === 403) return "This Switch API key can't do that. It needs the Editor role or higher.";
  if (error.status === 404) return "Switch Trust couldn't find that tenant, workspace or agent.";
  if (error.status === 503) return "On-demand evaluations aren't enabled on this Switch instance.";
  if (error.status >= 500) return "Switch Trust is having trouble right now. Try again shortly.";
  return `Switch Trust: ${error.message.slice(0, 200)}`;
}

/**
 * Who a key belongs to. The docs show both `ApiKey` and `Bearer` for the Authorization header, so we try ApiKey
 * first and remember whichever the instance accepts.
 */
export async function identifySwitchKey(baseUrl: string, apiKey: string) {
  let lastError: unknown = null;
  for (const scheme of ["ApiKey", "Bearer"] as const) {
    try {
      const identity = await call<{ tenant_id?: string; workspace_id?: string }>({ baseUrl, apiKey, scheme }, "GET", "/auth/api-key/identity");
      return { scheme, tenantId: identity.tenant_id ?? null, workspaceId: identity.workspace_id ?? null };
    } catch (error) {
      lastError = error;
      if (!(error instanceof SwitchApiError) || error.status !== 401) break;
    }
  }
  throw lastError;
}

const scoped = (creds: SwitchCredentials, resource: string) =>
  `/${resource}/tenants/${encodeURIComponent(creds.tenantId)}/workspaces/${encodeURIComponent(creds.workspaceId)}`;

/** Registers an agent by name; the id is a fingerprint, so registering the same name again returns the same agent. */
export async function registerSwitchAgent(creds: SwitchCredentials, name: string) {
  const { id } = await call<{ id?: string }>(creds, "POST", scoped(creds, "sparrow/agents"), { name });
  if (!id) throw new SwitchApiError(500, "Switch returned no agent id.");
  return id;
}

/** Where Switch's eval worker sends its tests: our OpenAI-compatible endpoint for this agent, with its credential. */
export async function putSwitchAgentEndpoint(
  creds: SwitchCredentials,
  agentId: string,
  endpoint: { url: string; credential: string; modelName: string }
) {
  await call(creds, "PUT", `${scoped(creds, "eval/agent-endpoints")}/${encodeURIComponent(agentId)}`, {
    model_type: "openai_compatible",
    endpoint_url: endpoint.url,
    endpoint_auth_type: "bearer",
    endpoint_credential: endpoint.credential,
    config: { model_name: endpoint.modelName, endpoint: "/v1/chat/completions", temperature: 0 },
  });
}

export async function listSwitchEvaluations(creds: SwitchCredentials) {
  const page = await call<{ items?: SwitchEvaluation[] }>(creds, "GET", `${scoped(creds, "eval/evaluations")}?page_size=100`);
  return page.items ?? [];
}

type AgentEvaluation = { id: string; evaluation_id?: string; latest_run_id?: string | null; latest_run_status?: string | null };

/** The agent's assignment of `evaluationId`, created on first use (manual runs only: no schedule). */
export async function ensureSwitchAssignment(creds: SwitchCredentials, agentId: string, evaluation: { id: string; name: string }) {
  const query = new URLSearchParams({ agent_id: agentId, evaluation_id: evaluation.id, page_size: "1" });
  const existing = await call<{ items?: AgentEvaluation[] }>(creds, "GET", `${scoped(creds, "eval/agent-evaluations")}?${query}`);
  const found = existing.items?.find((item) => item.evaluation_id === evaluation.id);
  if (found) return found;
  return call<AgentEvaluation>(creds, "POST", scoped(creds, "eval/agent-evaluations"), {
    agent_id: agentId,
    evaluation_id: evaluation.id,
    name: `TechTeam / ${evaluation.name}`,
    weight: 1,
  });
}

/** Starts a run now. If one was already requested (409), returns that run instead of starting a second. */
export async function triggerSwitchRun(creds: SwitchCredentials, agentEvaluationId: string) {
  const path = `${scoped(creds, "eval/agent-evaluations")}/${encodeURIComponent(agentEvaluationId)}`;
  try {
    const started = await call<{ run_id?: string; id?: string }>(creds, "POST", `${path}/trigger`);
    const runId = started.run_id ?? started.id;
    if (runId) return runId;
  } catch (error) {
    if (!(error instanceof SwitchApiError) || error.status !== 409) throw error;
  }
  const current = await call<AgentEvaluation>(creds, "GET", path);
  if (!current.latest_run_id) throw new SwitchApiError(500, "Switch didn't return the evaluation run.");
  return current.latest_run_id;
}

export function getSwitchRun(creds: SwitchCredentials, runId: string) {
  return call<SwitchRun>(creds, "GET", `${scoped(creds, "eval/evaluation-runs")}/${encodeURIComponent(runId)}`);
}

/** Every result of a run (100 per page, the API's maximum; capped at 50 pages). */
export async function listSwitchRunResults(creds: SwitchCredentials, runId: string) {
  const results: SwitchRunResult[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await call<{ items?: SwitchRunResult[]; total_pages?: number }>(
      creds,
      "GET",
      `${scoped(creds, "eval/evaluation-runs")}/${encodeURIComponent(runId)}/results?page_size=100&page=${page}`
    );
    results.push(...(batch.items ?? []));
    if (!batch.items?.length || page >= (batch.total_pages ?? 1)) break;
  }
  return results;
}

export function getSwitchAgentSummary(creds: SwitchCredentials, agentId: string) {
  return call<SwitchSummary>(creds, "GET", `${scoped(creds, "eval/agent-evaluation-summary")}?agent_id=${encodeURIComponent(agentId)}`);
}

/** Switch ROI: the agent's monthly spend cap in US dollars (its TechTeam budget), so Switch tracks it against the same limit. */
export async function putSwitchCostCap(creds: SwitchCredentials, agentId: string, monthlyCapUsd: number) {
  await call(creds, "PUT", `${scoped(creds, "cost/agent-caps")}/${encodeURIComponent(agentId)}`, { monthly_cap: monthlyCapUsd });
}
