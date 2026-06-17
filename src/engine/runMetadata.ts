/**
 * HEL-705: mutable run metadata.
 *
 * A run carries a free-form `metadata` object (≤256KB) that can be set at
 * trigger time and mutated from inside a run via a small op set — set / append
 * / increment / remove / replace — mirroring trigger.dev's run metadata. This
 * module is the pure logic (apply ops, parse a REST body, enforce the cap) so
 * it is unit-testable in isolation; runStore owns persistence and the route
 * owns transport.
 */

export type RunMetadata = Record<string, unknown>;

/** trigger.dev caps run metadata at 256KB; we enforce the same on the merged result. */
export const MAX_RUN_METADATA_BYTES = 256 * 1024;

export type RunMetadataOp =
  | { op: "set"; key: string; value: unknown }
  | { op: "append"; key: string; value: unknown }
  | { op: "increment"; key: string; amount?: number }
  | { op: "remove"; key: string }
  | { op: "replace"; value: RunMetadata };

/** Thrown on malformed ops or an over-cap result; the route maps it to a 400. */
export class RunMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunMetadataError";
  }
}

function isPlainObject(value: unknown): value is RunMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON byte length of a metadata object (the value persisted to the jsonb column). */
export function runMetadataByteLength(metadata: RunMetadata | undefined): number {
  return Buffer.byteLength(JSON.stringify(metadata ?? {}), "utf8");
}

/**
 * Apply a sequence of ops to the current metadata and return the new object
 * (the input is never mutated). Throws {@link RunMetadataError} on an invalid
 * op or when the result exceeds {@link MAX_RUN_METADATA_BYTES}.
 */
export function applyRunMetadataOps(
  current: RunMetadata | undefined,
  ops: RunMetadataOp[],
): RunMetadata {
  let next: RunMetadata = { ...(current ?? {}) };

  for (const op of ops) {
    switch (op.op) {
      case "replace": {
        if (!isPlainObject(op.value)) {
          throw new RunMetadataError("metadata replace requires an object value");
        }
        next = { ...op.value };
        break;
      }
      case "set": {
        next[op.key] = op.value;
        break;
      }
      case "remove": {
        delete next[op.key];
        break;
      }
      case "append": {
        const existing = next[op.key];
        const arr = Array.isArray(existing)
          ? [...existing]
          : existing === undefined
            ? []
            : [existing];
        arr.push(op.value);
        next[op.key] = arr;
        break;
      }
      case "increment": {
        const existing = next[op.key];
        const base = typeof existing === "number" && Number.isFinite(existing) ? existing : 0;
        const amount = op.amount ?? 1;
        if (typeof amount !== "number" || !Number.isFinite(amount)) {
          throw new RunMetadataError("metadata increment amount must be a finite number");
        }
        next[op.key] = base + amount;
        break;
      }
      default: {
        throw new RunMetadataError(`unknown metadata op: ${(op as { op?: unknown }).op}`);
      }
    }
  }

  const bytes = runMetadataByteLength(next);
  if (bytes > MAX_RUN_METADATA_BYTES) {
    throw new RunMetadataError(
      `run metadata exceeds the ${MAX_RUN_METADATA_BYTES}-byte limit (${bytes} bytes)`,
    );
  }
  return next;
}

const VALID_OPS = new Set(["set", "append", "increment", "remove", "replace"]);

/**
 * Parse a REST body into ops. Accepts `{ ops: [...] }`, a bare ops array, or a
 * convenience `{ metadata: {...} }` (⇒ a single `replace`). Throws
 * {@link RunMetadataError} on a malformed shape.
 */
export function parseRunMetadataOps(input: unknown): RunMetadataOp[] {
  const body = isPlainObject(input) ? input : {};
  if ("metadata" in body && !("ops" in body)) {
    if (!isPlainObject(body.metadata)) {
      throw new RunMetadataError("`metadata` must be an object");
    }
    return [{ op: "replace", value: body.metadata }];
  }

  const raw = Array.isArray(input) ? input : Array.isArray(body.ops) ? body.ops : null;
  if (!raw) {
    throw new RunMetadataError("expected `ops` (array) or `metadata` (object)");
  }

  return raw.map((entry): RunMetadataOp => {
    if (!isPlainObject(entry) || typeof entry.op !== "string" || !VALID_OPS.has(entry.op)) {
      throw new RunMetadataError("each op needs a valid `op` (set|append|increment|remove|replace)");
    }
    if (entry.op === "replace") {
      if (!isPlainObject(entry.value)) {
        throw new RunMetadataError("replace requires an object `value`");
      }
      return { op: "replace", value: entry.value };
    }
    if (typeof entry.key !== "string" || !entry.key.trim()) {
      throw new RunMetadataError(`${entry.op} requires a non-empty string \`key\``);
    }
    const key = entry.key;
    switch (entry.op) {
      case "set":
        return { op: "set", key, value: entry.value };
      case "append":
        return { op: "append", key, value: entry.value };
      case "remove":
        return { op: "remove", key };
      case "increment":
        return {
          op: "increment",
          key,
          ...(entry.amount !== undefined ? { amount: Number(entry.amount) } : {}),
        };
      default:
        throw new RunMetadataError(`unknown metadata op: ${entry.op}`);
    }
  });
}

/**
 * Validate trigger-time initial metadata: must be a plain object within the
 * size cap. Returns the object (or {} when absent). Throws on a bad shape/size
 * so a malformed `metadata` field fails the request rather than the run.
 */
export function sanitizeRunMetadata(input: unknown): RunMetadata {
  if (input === undefined || input === null) return {};
  if (!isPlainObject(input)) {
    throw new RunMetadataError("`metadata` must be an object");
  }
  const bytes = runMetadataByteLength(input);
  if (bytes > MAX_RUN_METADATA_BYTES) {
    throw new RunMetadataError(
      `run metadata exceeds the ${MAX_RUN_METADATA_BYTES}-byte limit (${bytes} bytes)`,
    );
  }
  return { ...input };
}
