/**
 * Short-lived memory of validated sessions, so every server action and poll doesn't ask the hosted auth service
 * again (it rate-limits: a board with a run in progress polls several actions every few seconds).
 *
 * - A session validated less than `freshMs` ago is reused.
 * - Concurrent lookups of the same token share one request.
 * - If the service fails (rate limit, outage), a session validated less than `staleMs` ago is still accepted.
 * - Never past the session's own expiry. Signed-out answers (null) aren't remembered.
 *
 * Pure (no server imports) so it can be unit tested; lib/auth.ts owns the instance.
 */
export type CachedSession = { session: { expiresAt: string } };

type Entry<S> = { value: S; checkedAt: number };

export function createSessionCache<S extends CachedSession>(options: {
  freshMs: number;
  staleMs: number;
  maxEntries?: number;
  now?: () => number;
}) {
  const { freshMs, staleMs, maxEntries = 1000 } = options;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<S>>();
  const inFlight = new Map<string, Promise<S | null>>();

  const usable = (entry: Entry<S>, maxAge: number) => now() - entry.checkedAt < maxAge && Date.parse(entry.value.session.expiresAt) > now();

  function remember(key: string, value: S) {
    // Re-inserted so the Map's order stays oldest-checked first (what eviction drops).
    entries.delete(key);
    entries.set(key, { value, checkedAt: now() });
    if (entries.size <= maxEntries) return;
    for (const [k, entry] of entries) {
      if (!usable(entry, staleMs)) entries.delete(k);
    }
    // Still full of live sessions: drop the oldest (Map keeps insertion order).
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  }

  return {
    /** The session for `key`, from memory when fresh enough, else from `validate` (null = signed out). */
    async get(key: string, validate: () => Promise<S | null>): Promise<S | null> {
      const cached = entries.get(key);
      if (cached && usable(cached, freshMs)) return cached.value;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = (async () => {
        try {
          const value = await validate();
          if (value) remember(key, value);
          else entries.delete(key);
          return value;
        } catch (error) {
          if (cached && usable(cached, staleMs)) return cached.value;
          throw error;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, request);
      return request;
    },
    /** Forget a session right away (sign-out). */
    forget(key: string) {
      entries.delete(key);
    },
  };
}
