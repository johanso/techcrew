import "server-only";

/**
 * Cloudhike Jobs (https://cloudhike.dev): background HTTP jobs. We queue a run that calls one of our own routes;
 * Cloudhike makes the call (with retries on 5xx and network errors) so the work happens outside the user's request.
 * Needs JOBS_API_URL + JOBS_API_KEY, and an app URL Cloudhike can reach (publicAppUrl).
 */

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;

function jobsConfig() {
  const url = process.env.JOBS_API_URL?.replace(/\/+$/, "");
  const key = process.env.JOBS_API_KEY;
  return url && key ? { url, key } : null;
}

export const jobsConfigured = () => jobsConfig() !== null;

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.+\.local|.+\.internal)$/i;

/**
 * The app's address as the internet sees it: PUBLIC_APP_URL (e.g. a tunnel in local dev), else NEXT_PUBLIC_APP_URL.
 * Null when that's a local address, which outside services can't call back.
 */
export function publicAppUrl() {
  const raw = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (LOCAL_HOST.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export class JobsError extends Error {}

/** Queues one HTTP call. Returns the job run id (202 from Cloudhike). */
export async function enqueueJob(job: {
  url: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutSeconds?: number;
  retries?: number;
}): Promise<string> {
  const config = jobsConfig();
  if (!config) throw new JobsError("Background jobs aren't configured (JOBS_API_URL, JOBS_API_KEY).");
  const response = await fetch(`${config.url}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.key },
    body: JSON.stringify({ method: "POST", ...job }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("[jobs] enqueue failed", response.status, await response.text().catch(() => ""));
    throw new JobsError(response.status === 401 || response.status === 403 ? "The jobs service rejected JOBS_API_KEY." : "The jobs service didn't accept the job.");
  }
  const { id } = (await response.json()) as { id?: unknown };
  if (typeof id !== "string") throw new JobsError("The jobs service returned no job id.");
  return id;
}

/** A job run's status and, when it failed, why (e.g. our URL was unreachable). Null when it can't be read. */
export async function getJobRun(id: string): Promise<{ status: JobRunStatus; error: string | null } | null> {
  const config = jobsConfig();
  if (!config) return null;
  try {
    const response = await fetch(`${config.url}/runs/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": config.key },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const run = (await response.json()) as { status?: unknown; error?: unknown };
    return { status: String(run.status ?? "unknown"), error: typeof run.error === "string" ? run.error : null };
  } catch (error) {
    console.warn("[jobs] status read failed", error);
    return null;
  }
}
