import { describe, expect, it, vi } from "vitest";

import { createSessionCache } from "@/lib/session-cache";

const HOUR = 3_600_000;

function setup() {
  let clock = 1_000_000;
  const cache = createSessionCache<{ session: { expiresAt: string }; id: string }>({
    freshMs: 60_000,
    staleMs: 600_000,
    maxEntries: 2,
    now: () => clock,
  });
  const session = (id: string, expiresIn = HOUR) => ({ id, session: { expiresAt: new Date(clock + expiresIn).toISOString() } });
  return { cache, session, advance: (ms: number) => (clock += ms) };
}

describe("createSessionCache", () => {
  it("reuses a fresh session and revalidates after freshMs", async () => {
    const { cache, session, advance } = setup();
    const validate = vi.fn(async () => session("a"));
    await cache.get("t", validate);
    advance(59_000);
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(1);
    advance(2_000);
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent lookups", async () => {
    const { cache, session } = setup();
    const validate = vi.fn(async () => session("a"));
    const [a, b] = await Promise.all([cache.get("t", validate), cache.get("t", validate)]);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("serves a stale session when the service fails, but not past staleMs", async () => {
    const { cache, session, advance } = setup();
    const ok = await cache.get("t", async () => session("a"));
    const failing = async () => {
      throw new Error("Too many requests");
    };
    advance(120_000);
    await expect(cache.get("t", failing)).resolves.toBe(ok);
    advance(600_000);
    await expect(cache.get("t", failing)).rejects.toThrow("Too many requests");
  });

  it("never serves a session past its own expiry", async () => {
    const { cache, session, advance } = setup();
    const validate = vi.fn(async () => session("a", 30_000));
    await cache.get("t", validate);
    advance(31_000);
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("doesn't remember signed-out answers and drops a session that became invalid", async () => {
    const { cache, session, advance } = setup();
    await cache.get("t", async () => session("a"));
    advance(61_000);
    expect(await cache.get("t", async () => null)).toBeNull();
    const validate = vi.fn(async () => null);
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("forgets on sign-out and stays within maxEntries", async () => {
    const { cache, session } = setup();
    const validate = vi.fn(async () => session("a"));
    await cache.get("t", validate);
    cache.forget("t");
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(2);

    await cache.get("u", async () => session("b"));
    await cache.get("v", async () => session("c"));
    // "t" was the oldest of three with room for two.
    await cache.get("t", validate);
    expect(validate).toHaveBeenCalledTimes(3);
  });
});
