/**
 * CRM Audit Logger — Structured logging for CRM data sent to Claude API
 *
 * Implements ALT-1409: logs field categories (never actual data values) for each
 * API call containing CRM data, providing a compliance audit trail.
 *
 * Captures: timestamp, user/session, field categories included, API endpoint called,
 * and any blocked field categories from the allowlist.
 */

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

/** In-memory audit log store. Replace with persistent store for production. */
const auditLog: CrmAuditEntry[] = [];

/**
 * Record an audit entry for a CRM data API call.
 * Logs to both the in-memory store and structured console output.
 */
export function recordAuditEntry(entry: CrmAuditEntry): void {
  auditLog.push(entry);
  console.info(
    JSON.stringify({
      level: "audit",
      event: "crm_data_api_call",
      ...entry,
    })
  );
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

/** Retrieve all audit entries (for testing and compliance queries). */
export function getAuditLog(): readonly CrmAuditEntry[] {
  return auditLog;
}

/** Clear audit log (for testing only). */
export function clearAuditLog(): void {
  auditLog.length = 0;
}
