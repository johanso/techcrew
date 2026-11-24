// GitHub's OAuth device flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow),
// as pure functions over an injected `fetch`: the page shows a code, the owner types it on github.com, and the app
// polls until GitHub hands over a token. No client secret is involved.

export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
/** `repo` lets agents read and push to private repositories; `read:user` identifies the account. */
export const DEVICE_SCOPE = "repo read:user";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const SLOW_DOWN_STEP_SEC = 5;
/** Fallback if GitHub omits the interval. */
const DEFAULT_INTERVAL_SEC = 5;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** What the server keeps between polls (in a sealed cookie, never in the page). */
export type DeviceFlowState = {
  deviceCode: string;
  intervalSec: number;
  expiresAtMs: number;
  lastPollAtMs: number;
};

export type DeviceCodeResult =
  | { ok: true; state: DeviceFlowState; userCode: string; verificationUri: string }
  | { ok: false; reason: "disabled" | "error"; message: string };

export type PollResult =
  | { status: "success"; accessToken: string; scope: string | null }
  | { status: "pending"; state: DeviceFlowState; retryInMs: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "disabled" }
  | { status: "error"; message: string };

export const DISABLED_MESSAGE = "Device Flow is switched off for this GitHub OAuth App. Enable it in the app's settings on GitHub.";

async function postForm(fetchFn: FetchLike, url: string, params: Record<string, string>) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data: data && typeof data === "object" ? (data as Record<string, unknown>) : null };
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

function unexpected(status: number) {
  return `GitHub answered in a way we didn't expect (HTTP ${status}). Try again in a moment.`;
}

/** Step 1: asks GitHub for a device and user code. */
export async function requestDeviceCode(fetchFn: FetchLike, clientId: string, now: number): Promise<DeviceCodeResult> {
  let response;
  try {
    response = await postForm(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope: DEVICE_SCOPE });
  } catch {
    return { ok: false, reason: "error", message: "We couldn't reach GitHub. Check your connection and try again." };
  }
  const { data } = response;
  if (data?.error === "device_flow_disabled") return { ok: false, reason: "disabled", message: DISABLED_MESSAGE };
  if (text(data?.error)) {
    return { ok: false, reason: "error", message: text(data?.error_description) ?? `GitHub refused the request (${data?.error}).` };
  }
  const deviceCode = text(data?.device_code);
  const userCode = text(data?.user_code);
  const verificationUri = text(data?.verification_uri);
  const expiresIn = positive(data?.expires_in);
  if (!response.ok || !deviceCode || !userCode || !verificationUri || !expiresIn) {
    return { ok: false, reason: "error", message: unexpected(response.status) };
  }
  const intervalSec = positive(data?.interval) ?? DEFAULT_INTERVAL_SEC;
  return {
    ok: true,
    userCode,
    verificationUri,
    // The first poll waits one interval, as GitHub asks.
    state: { deviceCode, intervalSec, expiresAtMs: now + expiresIn * 1000, lastPollAtMs: now },
  };
}

/** Step 2: one poll. Respects the interval (no request until it has passed) and GitHub's `slow_down`. */
export async function pollDeviceFlow(fetchFn: FetchLike, clientId: string, state: DeviceFlowState, now: number): Promise<PollResult> {
  if (now >= state.expiresAtMs) return { status: "expired" };
  const waitMs = state.lastPollAtMs + state.intervalSec * 1000 - now;
  if (waitMs > 0) return { status: "pending", state, retryInMs: waitMs };

  let response;
  try {
    response = await postForm(fetchFn, ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: state.deviceCode,
      grant_type: GRANT_TYPE,
    });
  } catch {
    return { status: "error", message: "We couldn't reach GitHub. Check your connection and try again." };
  }
  const { data } = response;
  const accessToken = text(data?.access_token);
  if (accessToken) return { status: "success", accessToken, scope: text(data?.scope) };

  switch (text(data?.error)) {
    case "authorization_pending":
      return { status: "pending", state: { ...state, lastPollAtMs: now }, retryInMs: state.intervalSec * 1000 };
    case "slow_down": {
      const intervalSec = state.intervalSec + SLOW_DOWN_STEP_SEC;
      return { status: "pending", state: { ...state, intervalSec, lastPollAtMs: now }, retryInMs: intervalSec * 1000 };
    }
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    case "device_flow_disabled":
      return { status: "disabled" };
    case null:
      return { status: "error", message: unexpected(response.status) };
    default:
      return { status: "error", message: text(data?.error_description) ?? `GitHub refused the sign-in (${data?.error}).` };
  }
}
