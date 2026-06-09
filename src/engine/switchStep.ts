/**
 * Switch / multi-route step (HEL-669, Phase 1).
 *
 * A Switch evaluates N ordered rules (each a safe condition) and routes to the
 * first matching route's target step, or to a fallback. It reuses the engine's
 * `jumpToStepIndex` escape hatch (the same one Loop and approval-request-changes
 * use) — here as a FORWARD jump, skipping the non-matching branches to land on
 * the chosen one.
 *
 * Config-driven (no graph cycle): routes name their target by step id.
 *   - `routes`: `[{ condition: string, targetStepId: string }, …]` (evaluated in order)
 *   - `fallbackStepId`: string? — taken when no route matches
 *
 * Forward-only: a route/fallback whose target is the Switch itself or an earlier
 * step is ignored (backward jumps are Loop's job), so a Switch can never create a
 * cycle. No match + no fallback → no jump (linear fall-through to the next step).
 */

import { safeEvalCondition } from "./safeConditionEval";
import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

interface SwitchRoute {
  condition?: string;
  targetStepId?: string;
}

export interface SwitchDecision {
  output: Record<string, unknown>;
  /** When set, the engine jumps forward to the chosen route's target. */
  jumpToStepIndex?: number;
}

export function resolveSwitchJump(
  step: WorkflowStep,
  template: WorkflowTemplate,
  context: Record<string, unknown>,
  currentStepIndex: number,
): SwitchDecision {
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  const routes: SwitchRoute[] = Array.isArray(cfg["routes"])
    ? (cfg["routes"] as SwitchRoute[])
    : [];
  const fallbackStepId =
    typeof cfg["fallbackStepId"] === "string" ? (cfg["fallbackStepId"] as string) : undefined;

  // Forward-only target resolution: a Switch routes to a DOWNSTREAM branch. A
  // target that is the Switch itself or earlier is ignored (that is Loop's job),
  // so a Switch can never introduce a cycle.
  const forwardIndexOf = (id?: string): number => {
    if (!id) return -1;
    const i = template.steps.findIndex((s) => s.id === id);
    return i > currentStepIndex ? i : -1;
  };

  let matchedRoute = -1;
  let targetIndex = -1;
  for (let r = 0; r < routes.length; r += 1) {
    const route = routes[r];
    if (!route || typeof route !== "object" || typeof route.condition !== "string") continue;
    let hit = false;
    try {
      hit = safeEvalCondition(route.condition, context);
    } catch {
      hit = false;
    }
    if (hit) {
      const t = forwardIndexOf(route.targetStepId);
      if (t >= 0) {
        matchedRoute = r;
        targetIndex = t;
        break;
      }
    }
  }

  if (targetIndex < 0) {
    const fb = forwardIndexOf(fallbackStepId);
    if (fb >= 0) targetIndex = fb; // matchedRoute stays -1 → "fallback"
  }

  const output: Record<string, unknown> = {
    switchMatchedRoute: matchedRoute >= 0 ? matchedRoute : null,
    switchRouted: targetIndex >= 0,
  };
  return targetIndex >= 0 ? { output, jumpToStepIndex: targetIndex } : { output };
}
