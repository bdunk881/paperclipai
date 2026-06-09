/**
 * Filter step (HEL-670, Phase 1).
 *
 * n8n's Filter drops the items that fail a predicate. Our engine runs over a
 * single shared context rather than per-item streams, so a Filter here operates
 * on an ARRAY field in context: it keeps the elements for which the predicate is
 * true and drops the rest, emitting the filtered array (plus kept/dropped counts)
 * for downstream steps.
 *
 * The predicate reuses the hardened `safeEvalCondition` and is evaluated per item
 * with the item's own fields spread into scope (and the whole item available as
 * `item`), so a rule can read `score > 50` or `item == 'x'`. A non-array source
 * or a missing predicate is a safe no-op (the array passes through unchanged).
 *
 * Config: `itemsKey` (the context array to filter) + `condition` (the predicate;
 * falls back to `step.condition`).
 */

import { safeEvalCondition } from "./safeConditionEval";
import type { WorkflowStep } from "../types/workflow";

export interface FilterResult {
  kept: unknown[];
  filteredIn: number;
  filteredOut: number;
}

export function applyItemFilter(
  step: WorkflowStep,
  context: Record<string, unknown>,
): FilterResult {
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  const itemsKey = typeof cfg["itemsKey"] === "string" ? (cfg["itemsKey"] as string) : undefined;
  const condition =
    typeof cfg["condition"] === "string"
      ? (cfg["condition"] as string)
      : typeof step.condition === "string"
        ? step.condition
        : undefined;

  const source = itemsKey ? context[itemsKey] : undefined;
  const items: unknown[] = Array.isArray(source) ? source : [];

  if (!condition) {
    return { kept: items, filteredIn: items.length, filteredOut: 0 };
  }

  const kept = items.filter((item) => {
    const scope: Record<string, unknown> =
      item && typeof item === "object" && !Array.isArray(item)
        ? { ...context, ...(item as Record<string, unknown>), item }
        : { ...context, item };
    try {
      return safeEvalCondition(condition, scope);
    } catch {
      // A malformed/unsafe predicate drops the item rather than aborting the run.
      return false;
    }
  });

  return { kept, filteredIn: kept.length, filteredOut: items.length - kept.length };
}
