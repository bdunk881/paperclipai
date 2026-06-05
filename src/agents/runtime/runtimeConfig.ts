/**
 * Per-agent runtime overrides, read from `agents.metadata.runtime.*`.
 *
 * Several agent-pipeline features read their per-agent knob through here —
 * `toolResultMaxChars` (HEL-623), `modelRetryMaxAttempts` (HEL-626),
 * `compactionThresholdChars` (HEL-624), and `maxToolIterations` (HEL-629).
 * Unset or invalid values return undefined so each consumer falls back to its
 * own default.
 */

/**
 * Read a non-negative finite number from `metadata.runtime[key]`. Returns
 * undefined when absent or invalid. A value of 0 IS honoured (e.g. it disables
 * tool-result truncation / model retry for that agent).
 */
export function readRuntimeNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const runtime = (metadata as { runtime?: unknown }).runtime;
  if (!runtime || typeof runtime !== "object") return undefined;
  const raw = (runtime as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}
