/**
 * Platform key-source pool — selects the best (provider, key) tuple for
 * an outgoing credits-mode LLM call.
 *
 * `platform_provider_keys` (migration 069) holds one row per key
 * source. In Phase 1 the table has a single row: a single OpenRouter
 * prepaid balance with source_kind='openrouter'. In Phase 2+ direct
 * provider rows are added with lower `priority` values (lower wins) so
 * they're preferred for their respective provider; the OpenRouter row
 * remains as a catch-all.
 *
 * Selection algorithm (pickKeySource):
 *   1. Filter rows by status='active' and not currently throttled.
 *   2. Find rows whose `provider` exactly matches the requested provider
 *      (these are direct-provider rows that match by name).
 *   3. UNION with rows whose source_kind='openrouter' (catch-all that
 *      can route any vendor).
 *   4. Sort by priority ascending (direct rows have lower priority),
 *      then by spend headroom desc, then random tiebreaker.
 *   5. Return the head; null if no source available.
 *
 * The selected key is decrypted via the connector secret vault and
 * surfaced as plaintext to the caller (engine adapter). The plaintext
 * never leaves the request scope.
 *
 * Throttle / 429 tracking + balance updates land in mutator functions
 * lower in this file. The hot path (`pickKeySource`) is a single read.
 */
import { randomUUID } from "node:crypto";

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { connectorSecretVault } from "../../integrations/shared/credentialRegistry";

export type KeySourceKind = "openrouter" | "direct";
export type KeySourceStatus =
  | "active"
  | "throttled"
  | "low_balance"
  | "disabled"
  | "retired";

export interface KeySourceRow {
  id: string;
  sourceKind: KeySourceKind;
  provider: string;
  label: string;
  status: KeySourceStatus;
  throttledUntil: string | null;
  prepaidBalanceUsd: number | null;
  prepaidBalanceObservedAt: string | null;
  dailySpendCapUsd: number | null;
  currentDaySpendUsd: number;
  currentDayKey: string | null;
  lastFourteenTwentyNineAt: string | null;
  consecutive429Count: number;
  priority: number;
}

export interface SelectedKeySource extends KeySourceRow {
  /** Decrypted plaintext. Caller must not log or persist this. */
  apiKey: string;
}

// allowlist: rolling counter / cached config; process-local by design
const inMemoryKeySources = new Map<string, KeySourceRow & { keyCiphertext: string }>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "credits keySourceStore requires DATABASE_URL outside development/test.",
  );
}

function rowToShape(row: {
  id: string;
  source_kind: string;
  provider: string;
  label: string;
  status: string;
  throttled_until: Date | null;
  prepaid_balance_usd: string | null;
  prepaid_balance_observed_at: Date | null;
  daily_spend_cap_usd: string | null;
  current_day_spend_usd: string;
  current_day_key: string | null;
  last_429_at: Date | null;
  consecutive_429_count: number;
  priority: number;
}): KeySourceRow {
  return {
    id: row.id,
    sourceKind: row.source_kind as KeySourceKind,
    provider: row.provider,
    label: row.label,
    status: row.status as KeySourceStatus,
    throttledUntil: row.throttled_until?.toISOString() ?? null,
    prepaidBalanceUsd: row.prepaid_balance_usd != null ? Number(row.prepaid_balance_usd) : null,
    prepaidBalanceObservedAt: row.prepaid_balance_observed_at?.toISOString() ?? null,
    dailySpendCapUsd: row.daily_spend_cap_usd != null ? Number(row.daily_spend_cap_usd) : null,
    currentDaySpendUsd: Number(row.current_day_spend_usd),
    currentDayKey: row.current_day_key,
    lastFourteenTwentyNineAt: row.last_429_at?.toISOString() ?? null,
    consecutive429Count: row.consecutive_429_count,
    priority: row.priority,
  };
}

/**
 * Pick the highest-priority healthy key source for the requested
 * provider. Returns null when nothing is available — the caller's
 * job to surface a friendly error.
 *
 * Direct-provider rows match by `provider` exactly. OpenRouter rows
 * match any provider lookup as a catch-all.
 */
export async function pickKeySource(provider: string): Promise<SelectedKeySource | null> {
  if (!persistenceAvailable()) {
    const candidates = [...inMemoryKeySources.values()]
      .filter((r) => r.status === "active")
      .filter((r) => r.throttledUntil == null || new Date(r.throttledUntil) <= new Date())
      .filter((r) => r.sourceKind === "openrouter" || r.provider === provider)
      .sort((a, b) => a.priority - b.priority);
    const chosen = candidates[0];
    if (!chosen) return null;
    return {
      ...chosen,
      apiKey: chosen.keyCiphertext.startsWith("inmem:")
        ? chosen.keyCiphertext.slice("inmem:".length)
        : connectorSecretVault.decrypt(chosen.keyCiphertext),
    };
  }

  const result = await queryPostgres<{
    id: string;
    source_kind: string;
    provider: string;
    label: string;
    key_ciphertext: string;
    status: string;
    throttled_until: Date | null;
    prepaid_balance_usd: string | null;
    prepaid_balance_observed_at: Date | null;
    daily_spend_cap_usd: string | null;
    current_day_spend_usd: string;
    current_day_key: string | null;
    last_429_at: Date | null;
    consecutive_429_count: number;
    priority: number;
  }>(
    `SELECT id, source_kind, provider, label, key_ciphertext, status,
            throttled_until, prepaid_balance_usd, prepaid_balance_observed_at,
            daily_spend_cap_usd, current_day_spend_usd, current_day_key,
            last_429_at, consecutive_429_count, priority
       FROM platform_provider_keys
      WHERE status = 'active'
        AND (throttled_until IS NULL OR throttled_until <= now())
        AND (source_kind = 'openrouter' OR provider = $1)
        AND (daily_spend_cap_usd IS NULL OR current_day_spend_usd < daily_spend_cap_usd)
      ORDER BY priority ASC, (
                COALESCE(daily_spend_cap_usd, 1e9) - current_day_spend_usd
              ) DESC
      LIMIT 1`,
    [provider],
  );

  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    ...rowToShape(row),
    apiKey: connectorSecretVault.decrypt(row.key_ciphertext),
  };
}

export async function markThrottled(
  keySourceId: string,
  retryAfterSeconds: number,
): Promise<void> {
  const until = new Date(Date.now() + retryAfterSeconds * 1000);
  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (row) {
      row.status = "throttled";
      row.throttledUntil = until.toISOString();
      row.consecutive429Count += 1;
      row.lastFourteenTwentyNineAt = new Date().toISOString();
    }
    return;
  }
  await queryPostgres(
    `UPDATE platform_provider_keys
        SET status = 'throttled',
            throttled_until = $2,
            consecutive_429_count = consecutive_429_count + 1,
            last_429_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [keySourceId, until.toISOString()],
  );
}

export async function recordSuccess(
  keySourceId: string,
  wholesaleCostUsd: number,
): Promise<void> {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (row) {
      if (row.currentDayKey !== todayKey) {
        row.currentDayKey = todayKey;
        row.currentDaySpendUsd = 0;
      }
      row.currentDaySpendUsd += wholesaleCostUsd;
      row.consecutive429Count = 0;
    }
    return;
  }
  await queryPostgres(
    `UPDATE platform_provider_keys
        SET current_day_spend_usd = CASE
              WHEN current_day_key = $2 THEN current_day_spend_usd + $3
              ELSE $3
            END,
            current_day_key = $2,
            consecutive_429_count = 0,
            updated_at = now()
      WHERE id = $1`,
    [keySourceId, todayKey, wholesaleCostUsd],
  );
}

export async function updatePrepaidBalance(
  keySourceId: string,
  balanceUsd: number,
): Promise<void> {
  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (row) {
      row.prepaidBalanceUsd = balanceUsd;
      row.prepaidBalanceObservedAt = new Date().toISOString();
    }
    return;
  }
  await queryPostgres(
    `UPDATE platform_provider_keys
        SET prepaid_balance_usd = $2,
            prepaid_balance_observed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [keySourceId, balanceUsd],
  );
}

export async function setStatus(
  keySourceId: string,
  status: KeySourceStatus,
): Promise<void> {
  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (row) row.status = status;
    return;
  }
  await queryPostgres(
    `UPDATE platform_provider_keys SET status = $2, updated_at = now() WHERE id = $1`,
    [keySourceId, status],
  );
}

export interface InsertKeySourceArgs {
  sourceKind: KeySourceKind;
  provider: string;
  label: string;
  /** Plaintext — encrypted on the way in. */
  apiKey: string;
  priority?: number;
  dailySpendCapUsd?: number;
}

export async function insertKeySource(args: InsertKeySourceArgs): Promise<string> {
  const id = randomUUID();
  const priority = args.priority ?? (args.sourceKind === "openrouter" ? 100 : 10);

  if (!persistenceAvailable()) {
    inMemoryKeySources.set(id, {
      id,
      sourceKind: args.sourceKind,
      provider: args.provider,
      label: args.label,
      status: "active",
      throttledUntil: null,
      prepaidBalanceUsd: null,
      prepaidBalanceObservedAt: null,
      dailySpendCapUsd: args.dailySpendCapUsd ?? null,
      currentDaySpendUsd: 0,
      currentDayKey: null,
      lastFourteenTwentyNineAt: null,
      consecutive429Count: 0,
      priority,
      keyCiphertext: `inmem:${args.apiKey}`,
    });
    return id;
  }

  const ciphertext = connectorSecretVault.encrypt(args.apiKey);
  await getPostgresPool().query(
    `INSERT INTO platform_provider_keys
       (id, source_kind, provider, label, key_ciphertext, priority, daily_spend_cap_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, args.sourceKind, args.provider, args.label, ciphertext, priority, args.dailySpendCapUsd ?? null],
  );
  return id;
}

export function __resetInMemoryStateForTests(): void {
  inMemoryKeySources.clear();
}
