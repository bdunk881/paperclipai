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
}

export class RedisMfaChallengeStore implements MfaChallengeStore {
  constructor(private readonly client: RedisLike) {}

  async remember(key: string, challenge: string): Promise<void> {
    await this.client.set(`${KEY_PREFIX}${key}`, challenge, "EX", MFA_CHALLENGE_TTL_SECONDS);
  }

  async consume(key: string): Promise<string | null> {
    const fullKey = `${KEY_PREFIX}${key}`;
    // Prefer atomic GETDEL (Redis 6.2+). If the deployed Redis is older
    // or returns a "not implemented" error, fall back to GET + DEL.
    // ioredis exposes arbitrary commands via `.call`, which keeps this
    // module independent of the ioredis client version.
    if (typeof this.client.call === "function") {
      try {
        const result = (await this.client.call("GETDEL", fullKey)) as string | null;
        return result ?? null;
      } catch {
        // Fall through to non-atomic path below.
      }
    }
    const value = await this.client.get(fullKey);
    if (value !== null) {
      await this.client.del(fullKey);
    }
    return value;
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
      return defaultStore;
    }
  }
  defaultStore = new InMemoryMfaChallengeStore();
  return defaultStore;
}

/** Test-only — replace or clear the default singleton. */
export function setMfaChallengeStoreForTests(store: MfaChallengeStore | null): void {
  defaultStore = store;
}
