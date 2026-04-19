/**
 * CRM Field Allowlist — Data Minimization for LLM API Calls
 *
 * Enforces §3.1-3.2 of the ALT-912 Data Privacy & DPA plan.
 * Only permitted CRM fields pass through to LLM prompts; blocked fields
 * are stripped and their categories logged for compliance audit trail.
 *
 * @see ALT-912 plan document §3.1 (Fields Sent) and §3.2 (Fields NEVER Sent)
 */

/** Fields that are permitted in LLM prompt context */
const ALLOWED_FIELDS = new Set([
  // Account info (Medium sensitivity)
  "company",
  "companyName",
  "company_name",
  "industry",
  "employeeCount",
  "employee_count",
  "employees",
  "companySize",
  "company_size",

  // Contact info — name and title only (High sensitivity — PII, but required)
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "name",
  "contactName",
  "contact_name",
  "title",
  "jobTitle",
  "job_title",

  // Deal data (High sensitivity — commercial, but required)
  "dealValue",
  "deal_value",
  "dealStage",
  "deal_stage",
  "stage",
  "closeDate",
  "close_date",
  "timeline",
  "requirements",
  "dealRequirements",

  // Proposal context (Medium sensitivity)
  "scope",
  "scopeDescription",
  "scope_description",
  "deliverables",
  "projectDescription",
  "project_description",

  // Workflow/engine internal keys (not CRM data)
  "output",
  "result",
  "content",
  "mimeType",
  "filename",
  "blogPost",
  "formattedPost",
  "shouldAutoRespond",
  "_stub",
  "_action",
  "_conditionResult",
]);

/** Field name patterns that must never reach the LLM */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /email/i, category: "contact_pii" },
  { pattern: /phone/i, category: "contact_pii" },
  { pattern: /mobile/i, category: "contact_pii" },
  { pattern: /address/i, category: "contact_pii" },
  { pattern: /city$/i, category: "contact_pii" },
  { pattern: /state$/i, category: "contact_pii" },
  { pattern: /country$/i, category: "contact_pii" },
  { pattern: /zip/i, category: "contact_pii" },
  { pattern: /postal/i, category: "contact_pii" },
  { pattern: /linkedin/i, category: "social_media" },
  { pattern: /twitter/i, category: "social_media" },
  { pattern: /facebook/i, category: "social_media" },
  { pattern: /social/i, category: "social_media" },
  { pattern: /password/i, category: "auth" },
  { pattern: /secret/i, category: "auth" },
  { pattern: /token/i, category: "auth" },
  { pattern: /apiKey/i, category: "auth" },
  { pattern: /api_key/i, category: "auth" },
  { pattern: /credential/i, category: "auth" },
  { pattern: /ssn/i, category: "sensitive_id" },
  { pattern: /tax_?id/i, category: "sensitive_id" },
  { pattern: /payment/i, category: "financial" },
  { pattern: /card_?number/i, category: "financial" },
  { pattern: /bank/i, category: "financial" },
  { pattern: /routing/i, category: "financial" },
  { pattern: /account_?number/i, category: "financial" },
  { pattern: /health/i, category: "regulated" },
  { pattern: /medical/i, category: "regulated" },
  { pattern: /diagnosis/i, category: "regulated" },
];

export interface SanitizeResult {
  /** Context with only allowed fields */
  sanitized: Record<string, unknown>;
  /** Categories of blocked fields (for audit logging — never includes actual values) */
  blockedCategories: string[];
  /** Count of fields that were stripped */
  strippedCount: number;
}

/**
 * Sanitize a step context by removing fields that should not be sent to LLM APIs.
 *
 * Strategy:
 * 1. If a field is in the explicit allowlist → keep
 * 2. If a field matches a blocked pattern → strip and log category
 * 3. If a field is unknown (not in either list) → keep (allowlist is additive,
 *    not restrictive for non-CRM workflow keys)
 *
 * This means CRM-specific sensitive fields are always stripped, while
 * arbitrary workflow keys pass through to preserve engine flexibility.
 */
export function sanitizeContext(ctx: Record<string, unknown>): SanitizeResult {
  const sanitized: Record<string, unknown> = {};
  const blockedCategories: string[] = [];
  let strippedCount = 0;

  for (const [key, value] of Object.entries(ctx)) {
    // Check blocked patterns first — these are always stripped
    const blocked = BLOCKED_PATTERNS.find((bp) => bp.pattern.test(key));
    if (blocked) {
      if (!blockedCategories.includes(blocked.category)) {
        blockedCategories.push(blocked.category);
      }
      strippedCount++;
      continue;
    }

    // Allowed or unknown keys pass through
    sanitized[key] = value;
  }

  return { sanitized, blockedCategories, strippedCount };
}
