/**
 * Redact sensitive fields from tool args/results before trace publish/persist.
 */

const SECRET_KEY_RE =
  /^(api[_-]?key|secret|token|password|authorization|credential|private[_-]?key)$/i;

const MAX_PREVIEW_CHARS = 8_192;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > MAX_PREVIEW_CHARS) {
      return `${value.slice(0, MAX_PREVIEW_CHARS)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactValue(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function redactToolArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const redacted = redactValue(args, 0);
  return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : args;
}

export function previewToolOutput(output: unknown): string {
  let text: string;
  try {
    text = typeof output === "string" ? output : JSON.stringify(output);
  } catch {
    text = String(output);
  }
  if (text.length > MAX_PREVIEW_CHARS) {
    return `${text.slice(0, MAX_PREVIEW_CHARS)}…`;
  }
  return text;
}
