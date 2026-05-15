import Redis from "ioredis";

let _client: Redis | null = null;

/**
 * Returns a singleton ioredis client for BullMQ.
 * Reads REDIS_URL (local/CI) or UPSTASH_REDIS_URL (production Upstash TCP).
 * Returns null when neither env var is set (tests, local dev without Redis).
 */
export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _client.on("error", (err: Error) => {
      console.warn("[redis] Connection error:", err.message);
    });
  }
  return _client;
}

export function resetRedisClientForTests(): void {
  if (_client) {
    _client.disconnect();
    _client = null;
  }
}
