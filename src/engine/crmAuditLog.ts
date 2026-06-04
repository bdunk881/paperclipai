/**
 * CRM Audit Logger — Structured logging for CRM data sent to Claude API
 *
 * Implements ALT-1409: logs field categories (never actual data values) for each
 * API call containing CRM data, providing a compliance audit trail.
 *
 * Captures: timestamp, user/session, field categories included, API endpoint called,
 * and any blocked field categories from the allowlist.
 *
 * HEL-460 (B3): the durable record is now the Postgres `crm_data_access_log`
 * table (written fire-and-forget on each call). The in-memory array is kept as
 * a bounded, best-effort debug ring; `getAuditLogAsync` is the queryable
 * compliance surface.
 */

import { isPostgresConfigured, queryPostgres } from "../db/postgres";

export interface CrmAuditEntry {
  timestamp: string;
  userId: string;
  runId: string;
  stepId: string;
  stepKind: "llm" | "agent";
  apiEndpoint: string;
  /** CRM field categories that were included in the API call */
  includedFieldCategories: string[];
  /** CRM field categories that were blocked by the allowlist */
  blockedFieldCategories: string[];
  /** Number of fields stripped by the allowlist */
  strippedFieldCount: number;
  /** Total number of fields in the original context */
  totalFieldCount: number;
}

/**
 * Classify a field key into a human-readable category for audit purposes.
 * Returns the category name — never the field value.
 */
function classifyFieldCategory(key: string): string {
  const lower = key.toLowerCase();

  // Account info
  if (/company|industry|employee|company_?size/.test(lower)) return "account_info";

  // Contact identity
  if (/^(first|last)?_?name$|contact_?name|^title$|job_?title/.test(lower)) return "contact_identity";

  // Deal data
  if (/deal|stage|close_?date|timeline|requirements/.test(lower)) return "deal_data";

  // Proposal/scope
  if (/scope|deliverables|project_?description/.test(lower)) return "proposal_context";

  // Internal/engine keys
  if (/^(output|result|content|mimeType|filename|_stub|_action|_conditionResult|blogPost|formattedPost|shouldAutoRespond)$/.test(key)) {
    return "engine_internal";
  }

  return "other";
}

/**
 * Build the list of included field categories from a sanitized context.
 * Groups fields by category and returns deduplicated category names.
 */
export function categorizeIncludedFields(sanitizedCtx: Record<string, unknown>): string[] {
  const categories = new Set<string>();
  for (const key of Object.keys(sanitizedCtx)) {
    categories.add(classifyFieldCategory(key));
  }
  return Array.from(categories).sort();
}

/**
 * Bounded in-memory ring of recent entries — a best-effort debug aid only. The
 * durable, queryable record is Postgres `crm_data_access_log` (see
 * `persistAuditEntry` / `getAuditLogAsync`). Capped so a long-lived process
 * can't leak memory the way the old unbounded array did.
 */
const MAX_IN_MEMORY_ENTRIES = 1000;
const auditLog: CrmAuditEntry[] = [];

/**
 * Record an audit entry for a CRM data API call. Writes durably to Postgres
 * (fire-and-forget so the audit never blocks or fails the step), plus the
 * structured console log and the bounded in-memory ring.
 */
export function recordAuditEntry(entry: CrmAuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > MAX_IN_MEMORY_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_IN_MEMORY_ENTRIES);
  }
  console.info(
    JSON.stringify({
      level: "audit",
      event: "crm_data_api_call",
      ...entry,
    })
  );
  void persistAuditEntry(entry);
}

async function persistAuditEntry(entry: CrmAuditEntry): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }
  try {
    await queryPostgres(
      `INSERT INTO crm_data_access_log (
         user_id, run_id, step_id, step_kind, api_endpoint,
         included_field_categories, blocked_field_categories,
         stripped_field_count, total_field_count, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::timestamptz)`,
      [
        entry.userId,
        entry.runId,
        entry.stepId,
        entry.stepKind,
        entry.apiEndpoint,
        JSON.stringify(entry.includedFieldCategories),
        JSON.stringify(entry.blockedFieldCategories),
        entry.strippedFieldCount,
        entry.totalFieldCount,
        entry.timestamp,
      ],
    );
  } catch (err) {
    // Audit is best-effort at the write boundary; the structured console.info
    // above is a secondary sink. Never throw into the step path.
    console.error("[crmAuditLog] Postgres persist failed:", (err as Error).message);
  }
}

/**
 * Build and record an audit entry from step execution context.
 * This is the primary integration point for step handlers.
 */
export function auditCrmApiCall(params: {
  userId: string;
  runId: string;
  stepId: string;
  stepKind: "llm" | "agent";
  apiEndpoint: string;
  originalFieldCount: number;
  sanitizedCtx: Record<string, unknown>;
  blockedCategories: string[];
  strippedCount: number;
}): void {
  const entry: CrmAuditEntry = {
    timestamp: new Date().toISOString(),
    userId: params.userId,
    runId: params.runId,
    stepId: params.stepId,
    stepKind: params.stepKind,
    apiEndpoint: params.apiEndpoint,
    includedFieldCategories: categorizeIncludedFields(params.sanitizedCtx),
    blockedFieldCategories: [...params.blockedCategories].sort(),
    strippedFieldCount: params.strippedCount,
    totalFieldCount: params.originalFieldCount,
  };
  recordAuditEntry(entry);
}

/**
 * Recent entries from the bounded in-memory ring (this process only). Use
 * `getAuditLogAsync` for durable, cross-instance compliance queries.
 */
export function getAuditLog(): readonly CrmAuditEntry[] {
  return auditLog;
}

interface CrmAuditRow {
  user_id: string;
  run_id: string;
  step_id: string;
  step_kind: "llm" | "agent";
  api_endpoint: string;
  included_field_categories: string[] | null;
  blocked_field_categories: string[] | null;
  stripped_field_count: number;
  total_field_count: number;
  recorded_at: Date | string;
}

/**
 * Durable compliance query — reads `crm_data_access_log` from Postgres, so it
 * sees entries from every instance and survives restarts. Falls back to the
 * in-memory ring only in dev/test (no Postgres).
 */
export async function getAuditLogAsync(
  filter: { userId?: string; runId?: string; limit?: number } = {},
): Promise<CrmAuditEntry[]> {
  if (!isPostgresConfigured()) {
    return [...auditLog]
      .filter((e) => (filter.userId ? e.userId === filter.userId : true))
      .filter((e) => (filter.runId ? e.runId === filter.runId : true));
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) {
    params.push(filter.userId);
    conditions.push(`user_id = $${params.length}`);
  }
  if (filter.runId) {
    params.push(filter.runId);
    conditions.push(`run_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
  const result = await queryPostgres<CrmAuditRow>(
    `SELECT user_id, run_id, step_id, step_kind, api_endpoint,
            included_field_categories, blocked_field_categories,
            stripped_field_count, total_field_count, recorded_at
       FROM crm_data_access_log
       ${where}
      ORDER BY recorded_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((r) => ({
    timestamp: r.recorded_at instanceof Date ? r.recorded_at.toISOString() : String(r.recorded_at),
    userId: r.user_id,
    runId: r.run_id,
    stepId: r.step_id,
    stepKind: r.step_kind,
    apiEndpoint: r.api_endpoint,
    includedFieldCategories: r.included_field_categories ?? [],
    blockedFieldCategories: r.blocked_field_categories ?? [],
    strippedFieldCount: r.stripped_field_count,
    totalFieldCount: r.total_field_count,
  }));
}

/** Clear the in-memory ring (for testing only). */
export function clearAuditLog(): void {
  auditLog.length = 0;
}
