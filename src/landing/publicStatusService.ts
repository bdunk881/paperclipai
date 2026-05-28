/**
 * Public status computation (HEL infra follow-up).
 *
 * Derives a customer-friendly status view from the same infra reads the
 * platform-admin Overview tab uses, but with all internal identifiers
 * scrubbed — no Fly machine ids, no error messages, no per-app
 * deployment ids. The output is suitable for status.helloautoflow.com
 * (or wherever the public status page is hosted).
 *
 * Cached in-process for STATUS_CACHE_TTL_MS so a public page that gets
 * hammered doesn't repeatedly hit Fly / Postgres / Redis / CF.
 */

import {
  checkPostgresConnection,
  getPostgresPool,
  isPostgresConfigured,
} from "../db/postgres";
import { checkRedisConnection, isRedisConfigured } from "../queue/redisClient";
import {
  getAgentPromptQueue,
  getDlqQueue,
  getRunQueue,
} from "../queue/queues";
import {
  getConfiguredFlyApps,
  listMachinesForApps,
} from "../adminConsole/infra/clients/flyClient";

export type PublicStatusLevel = "operational" | "degraded" | "down" | "unknown";

export interface PublicComponentStatus {
  /** Stable id for the component, e.g. "api" / "worker" / "dashboard". */
  id: string;
  name: string;
  level: PublicStatusLevel;
  message?: string;
}

export interface PublicStatusResponse {
  generated_at: string;
  overall: PublicStatusLevel;
  components: PublicComponentStatus[];
}

const STATUS_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  value: PublicStatusResponse;
}

// allowlist: public-status cache (single short-lived JSON blob; refreshed every 30s, no per-customer state)
let cache: CacheEntry | null = null;

/**
 * Maps internal Fly app names to public component names. Keeps internal
 * naming conventions (autoflow-api-production) out of the public surface.
 */
function publicComponentForFlyApp(appName: string): { id: string; name: string } {
  if (/production/i.test(appName)) {
    if (/worker/i.test(appName)) return { id: "worker", name: "Workflow worker" };
    return { id: "api", name: "Core API" };
  }
  // We don't surface dev/staging on the public status page.
  return { id: appName, name: appName };
}

async function flyComponents(): Promise<PublicComponentStatus[]> {
  if (!process.env.FLY_API_TOKEN) {
    return [
      { id: "api", name: "Core API", level: "unknown", message: "status not configured" },
    ];
  }
  const apps = getConfiguredFlyApps().filter((a) => /production/i.test(a));
  if (apps.length === 0) return [];
  const views = await listMachinesForApps(apps).catch(() =>
    apps.map((appName) => ({ appName, machines: [], error: "unreachable" })),
  );
  return views.map((v) => {
    const meta = publicComponentForFlyApp(v.appName);
    if (v.error) {
      return { id: meta.id, name: meta.name, level: "down" as const };
    }
    if (v.machines.length === 0) {
      return {
        id: meta.id,
        name: meta.name,
        level: "down" as const,
        message: "no machines available",
      };
    }
    const started = v.machines.filter((m) => m.state === "started").length;
    const total = v.machines.length;
    if (started === 0) {
      return { id: meta.id, name: meta.name, level: "down" as const };
    }
    if (started < total) {
      return {
        id: meta.id,
        name: meta.name,
        level: "degraded" as const,
        message: `${started}/${total} instances available`,
      };
    }
    return { id: meta.id, name: meta.name, level: "operational" as const };
  });
}

async function postgresComponent(): Promise<PublicComponentStatus> {
  if (!isPostgresConfigured()) {
    return { id: "database", name: "Database", level: "unknown" };
  }
  const ok = await checkPostgresConnection();
  return {
    id: "database",
    name: "Database",
    level: ok ? "operational" : "down",
  };
}

async function redisComponent(): Promise<PublicComponentStatus | null> {
  if (!isRedisConfigured()) return null;
  const reachable = await checkRedisConnection();
  if (!reachable) {
    return { id: "queue", name: "Job queue", level: "down" };
  }
  // Surface "degraded" if the DLQ has unusually high backlog. Threshold
  // intentionally generous — we surface customer-visible degradation, not
  // internal capacity planning.
  const dlq = getDlqQueue();
  if (!dlq) return { id: "queue", name: "Job queue", level: "operational" };
  try {
    const counts = await dlq.getJobCounts("failed", "waiting");
    const stuck = (counts.failed ?? 0) + (counts.waiting ?? 0);
    if (stuck > 500) {
      return {
        id: "queue",
        name: "Job queue",
        level: "degraded",
        message: "elevated backlog",
      };
    }
  } catch {
    /* ignore — queue stats are best-effort */
  }
  return { id: "queue", name: "Job queue", level: "operational" };
}

function overallLevel(components: PublicComponentStatus[]): PublicStatusLevel {
  const levels = new Set(components.map((c) => c.level));
  if (levels.has("down")) return "down";
  if (levels.has("degraded")) return "degraded";
  if (levels.size === 1 && levels.has("unknown")) return "unknown";
  return "operational";
}

interface LastLevelByComponent {
  [componentId: string]: PublicStatusLevel;
}

// allowlist: process-local memo of the previous status snapshot, used only to detect transitions for incident-timeline recording (the source of truth is the public_status_events table itself)
const lastLevelByComponent: LastLevelByComponent = {};

/**
 * Best-effort writer for the incident timeline. Inserts a row when a
 * component's level differs from the last snapshot we observed. Swallows
 * write failures — the status feed must never be blocked by the timeline
 * table being unavailable.
 */
async function recordTransitions(components: PublicComponentStatus[]): Promise<void> {
  if (!isPostgresConfigured()) return;
  const newTransitions = components.filter((c) => {
    const prev = lastLevelByComponent[c.id];
    if (prev === undefined) {
      lastLevelByComponent[c.id] = c.level;
      return false; // first observation — don't generate spurious "transition" rows on cold start
    }
    if (prev === c.level) return false;
    lastLevelByComponent[c.id] = c.level;
    return true;
  });
  if (newTransitions.length === 0) return;

  try {
    const pool = getPostgresPool();
    // One INSERT per transition; volume is tiny (only on flip), so the
    // per-row cost is fine.
    for (const c of newTransitions) {
      await pool.query(
        `INSERT INTO public_status_events (component_id, component_name, level, message)
           VALUES ($1, $2, $3, $4)`,
        [c.id, c.name, c.level, c.message ?? null],
      );
    }
  } catch (err) {
    console.warn(
      `[public-status] failed to record ${newTransitions.length} transition(s): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function computePublicStatus(now = Date.now()): Promise<PublicStatusResponse> {
  if (cache && cache.expiresAt > now) return cache.value;

  const [fly, postgres, redis] = await Promise.all([
    flyComponents(),
    postgresComponent(),
    redisComponent(),
  ]);

  const components: PublicComponentStatus[] = [...fly, postgres];
  if (redis) components.push(redis);

  // Fire-and-forget the transition writer so the read response doesn't
  // block on it. The fast path is "no transitions" → the writer is a
  // no-op.
  void recordTransitions(components);

  const value: PublicStatusResponse = {
    generated_at: new Date(now).toISOString(),
    overall: overallLevel(components),
    components,
  };

  cache = { expiresAt: now + STATUS_CACHE_TTL_MS, value };
  return value;
}

export interface PublicStatusEvent {
  id: string;
  component_id: string;
  component_name: string;
  level: PublicStatusLevel;
  message: string | null;
  recorded_at: string;
}

/**
 * Reads the most recent transitions across all components for the public
 * incident timeline. Capped at 50 by default — the page shows a window,
 * not the full history.
 */
export async function listRecentStatusEvents(limit = 50): Promise<PublicStatusEvent[]> {
  if (!isPostgresConfigured()) return [];
  try {
    const pool = getPostgresPool();
    const result = await pool.query<{
      id: string;
      component_id: string;
      component_name: string;
      level: PublicStatusLevel;
      message: string | null;
      recorded_at: Date;
    }>(
      `SELECT id, component_id, component_name, level, message, recorded_at
         FROM public_status_events
        ORDER BY recorded_at DESC
        LIMIT $1`,
      [Math.min(Math.max(1, limit), 200)],
    );
    return result.rows.map((r) => ({
      id: r.id,
      component_id: r.component_id,
      component_name: r.component_name,
      level: r.level,
      message: r.message,
      recorded_at: r.recorded_at.toISOString(),
    }));
  } catch (err) {
    console.warn(
      `[public-status] failed to read events: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

export function __resetPublicStatusCacheForTests(): void {
  cache = null;
  for (const k of Object.keys(lastLevelByComponent)) delete lastLevelByComponent[k];
}

// Touch unused imports to satisfy strict noUnused checks until/unless the
// worker-availability signal is added to the public page.
void getRunQueue;
void getAgentPromptQueue;
