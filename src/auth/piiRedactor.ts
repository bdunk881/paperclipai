/**
 * PII redaction utility for AutoFlow log safety.
 *
 * Redacts common Personally Identifiable Information and credential patterns
 * from strings and plain-object structures before they reach any log output.
 *
 * DATA_CLASS: Internal — this module itself is not sensitive, but handles Restricted data.
 */

/** Map of PII pattern name → replacement token */
const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Email addresses
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  // Phone numbers (E.164, US/intl formats)
  {
    name: "phone",
    pattern: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[PHONE]",
  },
  // Credit card numbers (Visa, MC, Amex, Discover — 13–16 digits with optional separators)
  {
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    replacement: "[CARD]",
  },
  // US Social Security Numbers
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN]",
  },
  // Bearer tokens / JWT-shaped strings
  {
    name: "bearer_token",
    pattern: /Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*/gi,
    replacement: "Bearer [TOKEN]",
  },
  // Generic API key patterns (long alphanumeric strings prefixed with sk-, pk-, key-, api-)
  {
    name: "api_key",
    pattern: /\b(?:sk|pk|key|api|secret|token)[-_][A-Za-z0-9\-_]{16,}/gi,
    replacement: "[TOKEN]",
  },
];

/**
 * Redact PII from a plain string.
 * Returns a new string with all matched patterns replaced.
 */
export function redactPiiString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Recursively redact PII from an object or primitive value.
 * - Strings are redacted.
 * - Arrays and plain objects are traversed.
 * - Non-string primitives (numbers, booleans) are passed through unchanged.
 *
 * Returns a new value; the original is never mutated.
 */
export function redactPii(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPiiString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactPii);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactPii(val);
    }
    return result;
  }
  return value;
}
