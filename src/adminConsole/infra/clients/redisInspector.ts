/**
 * Redis INFO inspector for the InfraData tab (HEL infra PR #5).
 *
 * Parses the response of `INFO` into the handful of stats useful for
 * triage: memory, ops/sec, keyspace, clients, persistence. Avoids
 * surfacing the entire INFO block (~3KB of mostly-irrelevant fields).
 *
 * Flush-pattern verb (deny-listed) lands in PR #7.
 */

import { getRedisClient, isRedisConfigured } from "../../../queue/redisClient";

export interface RedisKeyspaceStats {
  db: string;
  keys: number;
  expires: number;
  avg_ttl_ms: number;
}

export interface RedisView {
  available: boolean;
  reachable: boolean;
  version: string | null;
  uptime_seconds: number | null;
  connected_clients: number | null;
  blocked_clients: number | null;
  used_memory_bytes: number | null;
  used_memory_peak_bytes: number | null;
  used_memory_rss_bytes: number | null;
  ops_per_sec: number | null;
  total_commands_processed: number | null;
  hits: number | null;
  misses: number | null;
  keyspace: RedisKeyspaceStats[];
  persistence: {
    aof_enabled: boolean | null;
    rdb_last_save: number | null;
    rdb_changes_since_last_save: number | null;
  };
  error?: string;
}

function parseInfoSections(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return map;
}

function parseKeyspace(map: Map<string, string>): RedisKeyspaceStats[] {
  // INFO keyspace lines look like: db0:keys=42,expires=1,avg_ttl=0
  const out: RedisKeyspaceStats[] = [];
  for (const [key, value] of map.entries()) {
    if (!/^db\d+$/.test(key)) continue;
    const parts = Object.fromEntries(
      value.split(",").map((kv) => {
        const eq = kv.indexOf("=");
        return eq > 0 ? [kv.slice(0, eq), kv.slice(eq + 1)] : [kv, ""];
      }),
    );
    out.push({
      db: key,
      keys: Number(parts.keys ?? 0),
      expires: Number(parts.expires ?? 0),
      avg_ttl_ms: Number(parts.avg_ttl ?? 0),
    });
  }
  return out;
}

function numberOrNull(map: Map<string, string>, key: string): number | null {
  const raw = map.get(key);
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function inspectRedis(): Promise<RedisView> {
  const view: RedisView = {
    available: false,
    reachable: false,
    version: null,
    uptime_seconds: null,
    connected_clients: null,
    blocked_clients: null,
    used_memory_bytes: null,
    used_memory_peak_bytes: null,
    used_memory_rss_bytes: null,
    ops_per_sec: null,
    total_commands_processed: null,
    hits: null,
    misses: null,
    keyspace: [],
    persistence: {
      aof_enabled: null,
      rdb_last_save: null,
      rdb_changes_since_last_save: null,
    },
  };

  if (!isRedisConfigured()) return view;
  view.available = true;

  const client = getRedisClient();
  if (!client) {
    view.error = "redis client unavailable";
    return view;
  }

  try {
    const text = await client.info();
    const map = parseInfoSections(text);
    view.reachable = true;
    view.version = map.get("redis_version") ?? null;
    view.uptime_seconds = numberOrNull(map, "uptime_in_seconds");
    view.connected_clients = numberOrNull(map, "connected_clients");
    view.blocked_clients = numberOrNull(map, "blocked_clients");
    view.used_memory_bytes = numberOrNull(map, "used_memory");
    view.used_memory_peak_bytes = numberOrNull(map, "used_memory_peak");
    view.used_memory_rss_bytes = numberOrNull(map, "used_memory_rss");
    view.ops_per_sec = numberOrNull(map, "instantaneous_ops_per_sec");
    view.total_commands_processed = numberOrNull(map, "total_commands_processed");
    view.hits = numberOrNull(map, "keyspace_hits");
    view.misses = numberOrNull(map, "keyspace_misses");
    view.persistence.aof_enabled =
      map.has("aof_enabled") ? map.get("aof_enabled") === "1" : null;
    view.persistence.rdb_last_save = numberOrNull(map, "rdb_last_save_time");
    view.persistence.rdb_changes_since_last_save = numberOrNull(
      map,
      "rdb_changes_since_last_save",
    );
    view.keyspace = parseKeyspace(map);
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
  }

  return view;
}
