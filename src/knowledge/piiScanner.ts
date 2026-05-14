/**
 * PII scanner for save_memory tool inputs (HEL-88).
 *
 * Conservative pattern set — better to false-positive an embarrassed user
 * fixing their summary than to false-negative a stored SSN that leaks across
 * agents. Patterns:
 *
 *   - US SSN (XXX-XX-XXXX)
 *   - Major credit card numbers (Visa/MC/Amex/Discover, Luhn-validated)
 *   - Common API key prefixes (sk-, sk-ant-, AIza, ghp_, gho_, ghu_, ghs_,
 *     glpat-, rk_test_, rk_live_, sk_test_, sk_live_, npm_, ya29., key_)
 *   - JWT-shaped 3-part dot-separated tokens
 *   - AWS access key id pattern (AKIA[0-9A-Z]{16})
 *
 * Returns the first pattern matched (callers refuse the write + report it
 * so the agent can re-summarize). Empty string when content is clean.
 */

export interface PiiHit {
  kind:
    | "ssn"
    | "credit_card"
    | "api_key"
    | "jwt"
    | "aws_access_key";
  match: string;
}

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const AWS_AKID_RE = /\bAKIA[0-9A-Z]{16}\b/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const API_KEY_RE =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{8,}|rk_(?:test|live)_[A-Za-z0-9]{20,}|sk_(?:test|live)_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}|key_[A-Za-z0-9]{20,})\b/;

// Card numbers: 13-19 digits, optionally with spaces or hyphens
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanForPii(content: string): PiiHit | null {
  if (!content) return null;

  const ssn = SSN_RE.exec(content);
  if (ssn) return { kind: "ssn", match: ssn[0] };

  const akid = AWS_AKID_RE.exec(content);
  if (akid) return { kind: "aws_access_key", match: akid[0] };

  const apiKey = API_KEY_RE.exec(content);
  if (apiKey) return { kind: "api_key", match: apiKey[0] };

  const jwt = JWT_RE.exec(content);
  if (jwt) return { kind: "jwt", match: jwt[0] };

  // Card check is last — most expensive (Luhn). Find a candidate and validate.
  let m: RegExpExecArray | null;
  const cardRe = new RegExp(CARD_RE.source, "g");
  while ((m = cardRe.exec(content)) !== null) {
    if (luhnValid(m[0])) {
      return { kind: "credit_card", match: m[0] };
    }
  }

  return null;
}
