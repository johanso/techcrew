import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  DISABLED_MESSAGE,
  pollDeviceFlow,
  requestDeviceCode,
  type DeviceFlowState,
  type FetchLike,
} from "@/lib/device-flow";

const NOW = 1_800_000_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(String(init.body)), headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, calls };
}

const state = (patch: Partial<DeviceFlowState> = {}): DeviceFlowState => ({
  deviceCode: "dev-123",
  intervalSec: 5,
  expiresAtMs: NOW + 900_000,
  lastPollAtMs: NOW - 10_000,
  ...patch,
});

describe("requestDeviceCode", () => {
  const ok = { device_code: "dev-123", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };

  it("asks for the repo and read:user scopes with the client id only", async () => {
    const { fetchFn, calls } = fakeFetch(json(ok));
    const result = await requestDeviceCode(fetchFn, "Iv1.abc", NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DEVICE_CODE_URL);
    expect(Object.fromEntries(calls[0].body)).toEqual({ client_id: "Iv1.abc", scope: "repo read:user" });
    expect(calls[0].headers.accept).toBe("application/json");
    expect(result).toEqual({
      ok: true,
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      state: { deviceCode: "dev-123", intervalSec: 5, expiresAtMs: NOW + 900_000, lastPollAtMs: NOW },
    });
  });

  it("defaults the interval when GitHub omits it", async () => {
    const { interval: _interval, ...withoutInterval } = ok;
    const result = await requestDeviceCode(fakeFetch(json(withoutInterval)).fetchFn, "id", NOW);
    expect(result.ok && result.state.intervalSec).toBe(5);
  });

  it("reports a switched-off Device Flow", async () => {
    const result = await requestDeviceCode(fakeFetch(json({ error: "device_flow_disabled" })).fetchFn, "id", NOW);
    expect(result).toEqual({ ok: false, reason: "disabled", message: DISABLED_MESSAGE });
  });

  it("passes on GitHub's own error text", async () => {
    const result = await requestDeviceCode(
      fakeFetch(json({ error: "incorrect_client_credentials", error_description: "The client_id is invalid." }, 200)).fetchFn,
      "id",
      NOW
    );
    expect(result).toEqual({ ok: false, reason: "error", message: "The client_id is invalid." });
  });

  it("handles HTML or empty bodies, partial answers and network failures", async () => {
    for (const response of [new Response("<html>Bad gateway</html>", { status: 502 }), new Response("", { status: 200 }), json({ user_code: "X" })]) {
      const result = await requestDeviceCode(fakeFetch(response).fetchFn, "id", NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("error");
    }
    const offline = await requestDeviceCode(fakeFetch(new TypeError("fetch failed")).fetchFn, "id", NOW);
    expect(offline).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("pollDeviceFlow", () => {
  it("returns the token and scope once the owner authorized", async () => {
    const { fetchFn, calls } = fakeFetch(json({ access_token: "gho_abc", token_type: "bearer", scope: "repo,read:user" }));
    const result = await pollDeviceFlow(fetchFn, "Iv1.abc", state(), NOW);
    expect(result).toEqual({ status: "success", accessToken: "gho_abc", scope: "repo,read:user" });
    expect(calls[0].url).toBe(ACCESS_TOKEN_URL);
    expect(Object.fromEntries(calls[0].body)).toEqual({
      client_id: "Iv1.abc",
      device_code: "dev-123",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
  });

  it("keeps a missing scope as null", async () => {
    const result = await pollDeviceFlow(fakeFetch(json({ access_token: "gho_abc" })).fetchFn, "id", state(), NOW);
    expect(result).toEqual({ status: "success", accessToken: "gho_abc", scope: null });
  });

  it("keeps waiting on authorization_pending, one interval after this poll", async () => {
    const result = await pollDeviceFlow(fakeFetch(json({ error: "authorization_pending" })).fetchFn, "id", state(), NOW);
    expect(result).toEqual({ status: "pending", state: state({ lastPollAtMs: NOW }), retryInMs: 5000 });
  });

  it("adds five seconds on slow_down and remembers it", async () => {
    const result = await pollDeviceFlow(fakeFetch(json({ error: "slow_down", interval: 10 })).fetchFn, "id", state(), NOW);
    expect(result).toEqual({ status: "pending", state: state({ intervalSec: 10, lastPollAtMs: NOW }), retryInMs: 10_000 });
  });

  it("does not contact GitHub before the interval has passed", async () => {
    const { fetchFn, calls } = fakeFetch();
    const early = state({ lastPollAtMs: NOW - 2000 });
    const result = await pollDeviceFlow(fetchFn, "id", early, NOW);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ status: "pending", state: early, retryInMs: 3000 });
  });

  it("polls exactly at the interval", async () => {
    const { fetchFn, calls } = fakeFetch(json({ error: "authorization_pending" }));
    await pollDeviceFlow(fetchFn, "id", state({ lastPollAtMs: NOW - 5000 }), NOW);
    expect(calls).toHaveLength(1);
  });

  it("expires locally without a request once the code's life is over", async () => {
    const { fetchFn, calls } = fakeFetch();
    expect(await pollDeviceFlow(fetchFn, "id", state({ expiresAtMs: NOW }), NOW)).toEqual({ status: "expired" });
    expect(calls).toHaveLength(0);
  });

  it("maps GitHub's terminal errors", async () => {
    const run = (error: string) => pollDeviceFlow(fakeFetch(json({ error })).fetchFn, "id", state(), NOW);
    expect(await run("expired_token")).toEqual({ status: "expired" });
    expect(await run("access_denied")).toEqual({ status: "denied" });
    expect(await run("device_flow_disabled")).toEqual({ status: "disabled" });
  });

  it("turns other errors into a message", async () => {
    const withText = await pollDeviceFlow(fakeFetch(json({ error: "incorrect_device_code", error_description: "The device code is not valid." })).fetchFn, "id", state(), NOW);
    expect(withText).toEqual({ status: "error", message: "The device code is not valid." });
    const bare = await pollDeviceFlow(fakeFetch(json({ error: "unsupported_grant_type" })).fetchFn, "id", state(), NOW);
    expect(bare).toMatchObject({ status: "error" });
  });

  it("survives non-JSON bodies, HTTP errors and network failures", async () => {
    for (const response of [new Response("<html>Rate limited</html>", { status: 429 }), new Response("", { status: 500 }), json({}, 200), json("nope")]) {
      const result = await pollDeviceFlow(fakeFetch(response).fetchFn, "id", state(), NOW);
      expect(result.status).toBe("error");
    }
    const offline = await pollDeviceFlow(fakeFetch(new TypeError("fetch failed")).fetchFn, "id", state(), NOW);
    expect(offline.status).toBe("error");
  });
});
