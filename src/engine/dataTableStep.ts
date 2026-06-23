/**
 * Data Table step (HEL-813, parent HEL-713). The workflow node for the built-in
 * per-workspace data tables (the HEL-812 store) — so a workflow can persist and
 * read state across runs without an external DB (the n8n "Data Tables" pattern).
 *
 * Three operations:
 *   insert — append a row.
 *   upsert — insert-or-replace by `rowKey` (dedupe key).
 *   query  — read rows matching a jsonb-containment `filter` (+ optional limit).
 *
 * Config (every string value is interpolated from the run context — a lone
 * `{{key}}` resolves to the raw context value with its type preserved; an
 * embedded `{{key}}` is substituted into the surrounding string):
 *   operation: "insert" | "upsert" | "query"   (default "query")
 *   table:     string                            (required — the table name)
 *   rowKey?:   string                            (upsert: the dedupe key)
 *   data?:     object                            (insert / upsert: the row payload)
 *   filter?:   object                            (query: containment match)
 *   limit?:    number                            (query: max rows)
 *
 * Output merged into context for downstream steps:
 *   query        → { rows, rowCount, table, operation }
 *   insert/upsert→ { row, table, operation }
 * plus the same primary payload (rows / row) under the step's first outputKey,
 * when one is declared.
 *
 * Workspace-scoped: the engine resolves the run's workspaceId and passes it in;
 * the store's WHERE clause is the live tenancy filter.
 */

import { dataTableStore, type DataTableRow } from "./dataTableStore";
import type { WorkflowStep } from "../types/workflow";

export type DataTableOperation = "insert" | "upsert" | "query";

const OPERATIONS: readonly DataTableOperation[] = ["insert", "upsert", "query"];

/** Resolve the step's operation; anything unrecognized falls back to a read. */
export function resolveDataTableOperation(
  config: Record<string, unknown> | undefined,
): DataTableOperation {
  const raw = config?.["operation"];
  return typeof raw === "string" && (OPERATIONS as readonly string[]).includes(raw)
    ? (raw as DataTableOperation)
    : "query";
}

const LONE_PLACEHOLDER = /^\{\{(\w+)\}\}$/;

/**
 * Interpolate a config value against the run context. A string that is exactly
 * one `{{key}}` returns the raw context value (preserving objects/arrays/numbers);
 * any other string has its `{{key}}` placeholders substituted (missing keys keep
 * the literal placeholder). Objects/arrays are interpolated leaf-by-leaf.
 */
function interpolateValue(raw: unknown, context: Record<string, unknown>): unknown {
  if (typeof raw === "string") {
    const lone = raw.match(LONE_PLACEHOLDER);
    if (lone) {
      const val = context[lone[1]!];
      return val !== undefined ? val : raw;
    }
    return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const val = context[key];
      return val !== undefined ? String(val) : `{{${key}}}`;
    });
  }
  if (Array.isArray(raw)) return raw.map((v) => interpolateValue(v, context));
  if (raw && typeof raw === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = interpolateValue(v, context);
    }
    return out;
  }
  return raw;
}

/** Interpolate to a trimmed string ("" when absent / non-stringable). */
function stringField(raw: unknown, context: Record<string, unknown>): string {
  const v = interpolateValue(raw, context);
  if (v === undefined || v === null) return "";
  return (typeof v === "string" ? v : String(v)).trim();
}

/** A plain object, or {} for anything else (arrays included). */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A positive integer limit, or undefined (no cap). */
function resolveLimit(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function handleDataTable(
  step: WorkflowStep,
  context: Record<string, unknown>,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  const operation = resolveDataTableOperation(cfg);
  const table = stringField(cfg["table"], context);

  if (!workspaceId) {
    throw new Error("data_table step requires a workspaceId in the run context");
  }
  if (!table) {
    throw new Error("data_table step requires a 'table' name");
  }

  const namedKey = step.outputKeys?.[0];
  const withNamed = (
    base: Record<string, unknown>,
    payload: DataTableRow | DataTableRow[],
  ): Record<string, unknown> => {
    if (namedKey && !(namedKey in base)) base[namedKey] = payload;
    return base;
  };

  if (operation === "query") {
    const filter = asRecord(interpolateValue(cfg["filter"], context));
    const limit = resolveLimit(cfg["limit"]);
    const rows = await dataTableStore.queryRows(workspaceId, table, {
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
      ...(limit ? { limit } : {}),
    });
    return withNamed({ rows, rowCount: rows.length, table, operation }, rows);
  }

  const data = asRecord(interpolateValue(cfg["data"], context));

  if (operation === "upsert") {
    const rowKey = stringField(cfg["rowKey"], context);
    if (!rowKey) {
      throw new Error("data_table upsert requires a 'rowKey'");
    }
    const row = await dataTableStore.upsertRow(workspaceId, table, rowKey, data);
    return withNamed({ row, table, operation }, row);
  }

  // insert
  const row = await dataTableStore.insertRow(workspaceId, table, data);
  return withNamed({ row, table, operation }, row);
}
