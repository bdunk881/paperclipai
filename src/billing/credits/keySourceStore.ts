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
import { emitRoutingAffinityUsed } from "./routingTelemetry";

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

export interface PickKeySourceOptions {
  /**
   * HEL-603 sub-agent affinity: prefer this key source if it is still
   * eligible (same active-OR-throttled-cooldown-passed + provider-match +
   * daily-cap predicate as normal selection). When set and eligible we
   * short-circuit to it for prompt-cache locality across a delegation
   * fan-out; otherwise we fall through to `priority ASC` selection. A
   * stale or wrong-provider id simply fails the eligibility check and we
   * fall through — the hint is never trusted blindly.
   */
  preferSourceId?: string;
}

/** Row shape returned by the two `pickKeySource` SELECTs (includes the ciphertext). */
type PickKeySourceQueryRow = {
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
};

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
 *
 * HEL-603: when `opts.preferSourceId` is supplied and that row is still
 * eligible, we short-circuit to it (sub-agent affinity for prompt-cache
 * locality) and emit `routing.affinity_used`. Otherwise selection is
 * unchanged: `priority ASC`, then spend headroom.
 */
export async function pickKeySource(
  provider: string,
  opts: PickKeySourceOptions = {},
): Promise<SelectedKeySource | null> {
  if (!persistenceAvailable()) {
    const now = new Date();
    const decryptKey = (r: KeySourceRow & { keyCiphertext: string }): string =>
      r.keyCiphertext.startsWith("inmem:")
        ? r.keyCiphertext.slice("inmem:".length)
        : connectorSecretVault.decrypt(r.keyCiphertext);
    const candidates = [...inMemoryKeySources.values()]
      .filter((r) => {
        // A row is eligible when it's `active` OR its `throttled` cooldown
        // has expired. Mirrors the SQL WHERE in the Postgres branch — and
        // is the fix for the Codex P1: previously a 429 flipped status to
        // 'throttled' and the row was never picked again, even after
        // throttled_until passed.
        if (r.status === "active") return true;
        if (
          r.status === "throttled"
          && r.throttledUntil != null
          && new Date(r.throttledUntil) <= now
        ) {
          return true;
        }
        return false;
      })
      .filter((r) => r.sourceKind === "openrouter" || r.provider === provider);
    // HEL-603 affinity: stick to the parent's source when it's still
    // eligible, before falling back to priority order.
    if (opts.preferSourceId) {
      const preferred = candidates.find((r) => r.id === opts.preferSourceId);
      if (preferred) {
        emitRoutingAffinityUsed({
          sourceId: preferred.id,
          provider,
          sourceKind: preferred.sourceKind,
        });
        return { ...preferred, apiKey: decryptKey(preferred) };
      }
    }
    const chosen = candidates.sort((a, b) => a.priority - b.priority)[0];
    if (!chosen) return null;
    return { ...chosen, apiKey: decryptKey(chosen) };
  }

  // HEL-603 affinity: try the preferred (parent's) source first, using the
  // SAME eligibility predicate as the priority query below. A hit keeps the
  // delegation chain on one source for prompt-cache locality; a miss (stale,
  // throttled, wrong-provider, or capped row) falls through unchanged.
  if (opts.preferSourceId) {
    const preferred = await queryPostgres<PickKeySourceQueryRow>(
      `SELECT id, source_kind, provider, label, key_ciphertext, status,
              throttled_until, prepaid_balance_usd, prepaid_balance_observed_at,
              daily_spend_cap_usd, current_day_spend_usd, current_day_key,
              last_429_at, consecutive_429_count, priority
         FROM platform_provider_keys
        WHERE id = $2
          AND (
                status = 'active'
                OR (status = 'throttled' AND throttled_until IS NOT NULL AND throttled_until <= now())
              )
          AND (source_kind = 'openrouter' OR provider = $1)
          AND (daily_spend_cap_usd IS NULL OR current_day_spend_usd < daily_spend_cap_usd)
        LIMIT 1`,
      [provider, opts.preferSourceId],
    );
    if ((preferred.rowCount ?? 0) > 0) {
      const prow = preferred.rows[0];
      emitRoutingAffinityUsed({
        sourceId: prow.id,
        provider,
        sourceKind: prow.source_kind,
      });
      return {
        ...rowToShape(prow),
        apiKey: connectorSecretVault.decrypt(prow.key_ciphertext),
      };
    }
  }

  const result = await queryPostgres<PickKeySourceQueryRow>(
    `SELECT id, source_kind, provider, label, key_ciphertext, status,
            throttled_until, prepaid_balance_usd, prepaid_balance_observed_at,
            daily_spend_cap_usd, current_day_spend_usd, current_day_key,
            last_429_at, consecutive_429_count, priority
       FROM platform_provider_keys
      -- Eligible = currently active OR previously throttled but the
      -- cooldown has now passed. Codex P1: the original "status = active"
      -- filter meant a single 429 flipped status to throttled and the
      -- row never auto-recovered. recordSuccess (below) flips the row
      -- back to active when the next call succeeds.
      WHERE (
              status = 'active'
              OR (status = 'throttled' AND throttled_until IS NOT NULL AND throttled_until <= now())
            )
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
      // Codex P1: a successful call against a previously throttled row
      // means the provider is happy with us again. Flip status back so
      // observability + future pickKeySource WHERE clauses are accurate.
      // Only touches 'throttled' — leaves 'low_balance' / 'disabled' /
      // 'retired' alone (those are gated by other signals).
      if (row.status === "throttled") {
        row.status = "active";
        row.throttledUntil = null;
      }
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
            -- Codex P1: promote throttled → active on success. Leaves
            -- low_balance / disabled / retired intact.
            status = CASE WHEN status = 'throttled' THEN 'active' ELSE status END,
            throttled_until = CASE WHEN status = 'throttled' THEN NULL ELSE throttled_until END,
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

/**
 * HEL-250: list every row in the pool (admin panel use only). Excludes the
 * decrypted secret — the table renders metadata + masked tail only.
 */
export async function listKeySources(): Promise<KeySourceRow[]> {
  if (!persistenceAvailable()) {
    return [...inMemoryKeySources.values()]
      .map((r) => {
        const { keyCiphertext: _ignored, ...meta } = r;
        return meta;
      })
      .sort((a, b) => a.priority - b.priority);
  }
  const result = await queryPostgres<{
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
  }>(
    `SELECT id, source_kind, provider, label, status,
            throttled_until, prepaid_balance_usd, prepaid_balance_observed_at,
            daily_spend_cap_usd, current_day_spend_usd, current_day_key,
            last_429_at, consecutive_429_count, priority
       FROM platform_provider_keys
      ORDER BY priority ASC, label ASC`,
  );
  return result.rows.map(rowToShape);
}

/**
 * HEL-250: swap a key's ciphertext atomically. Used when an existing key has
 * been compromised. Clears `prepaid_balance_observed_at` so the watchdog
 * recomputes on the next tick — the new key may belong to a different
 * prepaid account.
 *
 * Returns true on success, false when the row doesn't exist.
 */
export async function rotateKeySourceCiphertext(
  keySourceId: string,
  newApiKey: string,
): Promise<boolean> {
  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (!row) return false;
    row.keyCiphertext = `inmem:${newApiKey}`;
    row.prepaidBalanceUsd = null;
    row.prepaidBalanceObservedAt = null;
    row.consecutive429Count = 0;
    return true;
  }
  const ciphertext = connectorSecretVault.encrypt(newApiKey);
  const result = await queryPostgres(
    `UPDATE platform_provider_keys
        SET key_ciphertext = $2,
            key_version = key_version + 1,
            prepaid_balance_usd = NULL,
            prepaid_balance_observed_at = NULL,
            consecutive_429_count = 0,
            updated_at = now()
      WHERE id = $1`,
    [keySourceId, ciphertext],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface UpdateKeySourceMetaArgs {
  priority?: number;
  dailySpendCapUsd?: number | null;
  label?: string;
}

/**
 * HEL-250: update non-secret metadata. Pass undefined to leave a field
 * unchanged; pass null on dailySpendCapUsd to clear it.
 */
export async function updateKeySourceMeta(
  keySourceId: string,
  patch: UpdateKeySourceMetaArgs,
): Promise<boolean> {
  if (
    patch.priority === undefined
    && patch.dailySpendCapUsd === undefined
    && patch.label === undefined
  ) {
    return true;
  }

  if (!persistenceAvailable()) {
    const row = inMemoryKeySources.get(keySourceId);
    if (!row) return false;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.dailySpendCapUsd !== undefined) row.dailySpendCapUsd = patch.dailySpendCapUsd;
    if (patch.label !== undefined) row.label = patch.label;
    return true;
  }

  // Build a dynamic SET clause from only the fields the caller is changing.
  const set: string[] = [];
  const args: unknown[] = [keySourceId];
  if (patch.priority !== undefined) {
    args.push(patch.priority);
    set.push(`priority = $${args.length}`);
  }
  if (patch.dailySpendCapUsd !== undefined) {
    args.push(patch.dailySpendCapUsd);
    set.push(`daily_spend_cap_usd = $${args.length}`);
  }
  if (patch.label !== undefined) {
    args.push(patch.label);
    set.push(`label = $${args.length}`);
  }
  set.push(`updated_at = now()`);
  const result = await queryPostgres(
    `UPDATE platform_provider_keys SET ${set.join(", ")} WHERE id = $1`,
    args,
  );
  return (result.rowCount ?? 0) > 0;
}
