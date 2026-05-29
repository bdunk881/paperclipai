/**
 * Persistent challenge store for WebAuthn ceremonies (HEL-303).
 *
 * The WebAuthn registration + authentication ceremonies are two-trip:
 *
 *   1. `begin*` — server generates a fresh challenge, returns it to the
 *      browser as part of the options payload.
 *   2. `finish*` — browser sends the authenticator's response; the
 *      server has to look up the challenge it generated in step 1 to
 *      verify the response is bound to it.
 *
 * Before HEL-303 the lookup table was a per-process `Map`. The two
 * trips have to land on the same Node process for the lookup to
 * succeed — which is fine on a single-machine dev box but breaks under:
 *   - Fly rolling restarts (any PR merge to `dev` rotates the machine)
 *   - `auto_start_machines = true` spinning a second machine mid-flow
 *   - Any future `min_machines_running ≥ 2` deploy
 *
 * Redis-backed store fixes it: the challenge survives restarts and is
 * visible to every API process. TTL is enforced via Redis's native
 * `EX`. Consumption is atomic via `GETDEL` (Redis 6.2+) so a
 * double-submitted verify can't both succeed and can't both fail
 * silently.
 *
 * Fall back to in-memory when Redis isn't configured — covers unit
 * tests + AUTOFLOW_ALLOW_INMEMORY local dev. Production has REDIS_URL
 * (or UPSTASH_REDIS_URL) on every Fly env (the worker already requires
 * it to boot).
 */

import { isRedisConfigured, getRedisClient } from "../queue/redisClient";

/**
 * Default TTL for an MFA challenge entry. Mirrors the prior 5-minute
 * window — long enough for the user to confirm with Touch ID / a
 * security key, short enough that a leaked challenge expires before it
 * can be replayed.
 */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

const KEY_PREFIX = "mfa:challenge:";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MfaChallengeStore {
  /** Persist a challenge for `key`. TTL is `MFA_CHALLENGE_TTL_SECONDS`. */
  remember(key: string, challenge: string): Promise<void>;
  /**
   * Atomically read + delete the challenge for `key`. Returns null when
   * the key is missing or expired. Implementations MUST guarantee
   * single-use semantics (a second call for the same key returns null,
   * even under concurrent reads).
   */
  consume(key: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Redis-backed implementation
// ---------------------------------------------------------------------------

/**
 * Tiny structural type for the Redis client surface we touch. Defined
 * here (rather than importing `Redis` from ioredis) so the test file
 * can hand us any mock that quacks like a Redis without dragging the
 * library into the test runtime.
 */
export interface RedisLike {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  call?(command: string, ...args: unknown[]): Promise<unknown>;
  // HEL-326 diagnostics (optional — used for read-back + miss forensics).
  ttl?(key: string): Promise<number>;
  exists?(key: string): Promise<number>;
}

export class RedisMfaChallengeStore implements MfaChallengeStore {
  constructor(private readonly client: RedisLike) {}

  async remember(key: string, challenge: string): Promise<void> {
    const fullKey = `${KEY_PREFIX}${key}`;
    await this.client.set(fullKey, challenge, "EX", MFA_CHALLENGE_TTL_SECONDS);
    // HEL-326 diagnostic: read TTL straight back after SET. If the write
    // didn't actually persist to the same Redis this client reads from
    // (ACL gap, wrong DB, replica), TTL will be -2 (missing) / -1 (no
    // expiry) right here — the cleanest signal for the "challenge expired
    // or missing" mystery. Logged at info so it surfaces in `fly logs`.
    if (typeof this.client.ttl === "function") {
      try {
        const ttl = await this.client.ttl(fullKey);
        if (ttl < 0) {
          console.warn(
            `[mfa] challenge SET did not persist (ttl=${ttl}) key=${fullKey} — write/ACL/instance problem`,
          );
        } else {
          console.info(`[mfa] challenge stored key=${fullKey} ttl=${ttl}`);
        }
      } catch (err) {
        console.warn(`[mfa] challenge TTL read-back failed key=${fullKey}: ${errMsg(err)}`);
      }
    }
  }

  async consume(key: string): Promise<string | null> {
    const fullKey = `${KEY_PREFIX}${key}`;
    let value: string | null = null;
    let usedFallback = false;

    // Prefer atomic GETDEL (Redis 6.2+). If the deployed Redis is older,
    // or the connection's ACL forbids GETDEL, fall back to GET + DEL.
    if (typeof this.client.call === "function") {
      try {
        const result = (await this.client.call("GETDEL", fullKey)) as string | null;
        value = result ?? null;
      } catch (err) {
        // HEL-326: do NOT swallow silently — an ACL `NOPERM` on GETDEL
        // would otherwise hide here and make this look like a missing
        // challenge. Surface it, then fall back.
        console.warn(`[mfa] GETDEL unavailable key=${fullKey}: ${errMsg(err)} — using GET+DEL`);
        usedFallback = true;
      }
    } else {
      usedFallback = true;
    }

    if (usedFallback) {
      value = await this.client.get(fullKey);
      if (value !== null) {
        try {
          await this.client.del(fullKey);
        } catch (err) {
          console.warn(`[mfa] DEL failed key=${fullKey}: ${errMsg(err)}`);
        }
      }
    }

    if (value === null) {
      await this.logConsumeMiss(fullKey);
    }
    return value;
  }

  /**
   * HEL-326: a consume MISS within the TTL window should be impossible
   * once `remember` persisted the key. Dump what Redis actually holds so
   * the cause (key absent vs present-under-different-name vs empty DB /
   * wrong instance) is visible in `fly logs` on the next failed attempt.
   */
  private async logConsumeMiss(fullKey: string): Promise<void> {
    let exists: number | string = "unknown";
    let liveKeys: number | string = "unknown";
    try {
      if (typeof this.client.exists === "function") {
        exists = await this.client.exists(fullKey);
      }
    } catch (err) {
      exists = `err:${errMsg(err)}`;
    }
    try {
      if (typeof this.client.call === "function") {
        const res = (await this.client.call(
          "SCAN",
          "0",
          "MATCH",
          `${KEY_PREFIX}*`,
          "COUNT",
          "100",
        )) as [string, string[]] | null;
        liveKeys = Array.isArray(res?.[1]) ? res[1].length : "unknown";
      }
    } catch (err) {
      liveKeys = `err:${errMsg(err)}`;
    }
    console.warn(
      `[mfa] consume MISS key=${fullKey} exists=${exists} liveChallengeKeys=${liveKeys}`,
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests + AUTOFLOW_ALLOW_INMEMORY dev)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  challenge: string;
  expiresAt: number;
}

export class InMemoryMfaChallengeStore implements MfaChallengeStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number = MFA_CHALLENGE_TTL_SECONDS) {
    this.ttlMs = ttlSeconds * 1000;
  }

  async remember(key: string, challenge: string): Promise<void> {
    // Opportunistic eviction so a long-lived process doesn't accumulate
    // expired entries forever. Cheap because the map is small (one
    // entry per concurrent MFA ceremony).
    const now = Date.now();
    for (const [k, v] of this.entries.entries()) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
    this.entries.set(key, { challenge, expiresAt: now + this.ttlMs });
  }

  async consume(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.expiresAt <= Date.now()) return null;
    return entry.challenge;
  }

  /** Test-only — reset between cases without re-instantiating. */
  reset(): void {
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

let defaultStore: MfaChallengeStore | null = null;

/**
 * Returns the process-wide default challenge store. Redis-backed when
 * REDIS_URL / UPSTASH_REDIS_URL is set; otherwise an in-memory store
 * (acceptable only for tests + single-process local dev — see module
 * docstring).
 */
export function getDefaultMfaChallengeStore(): MfaChallengeStore {
  if (defaultStore) return defaultStore;
  if (isRedisConfigured()) {
    const client = getRedisClient();
    if (client) {
      defaultStore = new RedisMfaChallengeStore(client as unknown as RedisLike);
      console.info("[mfa] challenge store backend: redis");
      return defaultStore;
    }
  }
  // HEL-326: in-memory is process-local — a WebAuthn/step-up ceremony that
  // spans two HTTP requests breaks if they land on different processes,
  // and silently swapping in this backend is what made cross-process
  // failures look like "challenge expired or missing". In a deployed
  // environment (NODE_ENV=production on Fly) refuse it and fail loud, so a
  // missing Redis URL crashes at startup/first-use instead of degrading.
  const redisRequired =
    process.env.NODE_ENV === "production" && process.env.AUTOFLOW_ALLOW_INMEMORY !== "true";
  if (redisRequired) {
    throw new Error(
      "[mfa] challenge store requires Redis (REDIS_URL or UPSTASH_REDIS_URL) in production. " +
        "Refusing the in-memory fallback — it loses challenges across processes/restarts. " +
        "Set AUTOFLOW_ALLOW_INMEMORY=true only for single-process local dev.",
    );
  }
  defaultStore = new InMemoryMfaChallengeStore();
  console.info("[mfa] challenge store backend: in-memory (dev/test fallback)");
  return defaultStore;
}

/** Test-only — replace or clear the default singleton. */
export function setMfaChallengeStoreForTests(store: MfaChallengeStore | null): void {
  defaultStore = store;
}
