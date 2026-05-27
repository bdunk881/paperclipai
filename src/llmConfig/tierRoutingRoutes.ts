/**
 * Express routes for /api/tier-routing.
 *
 * Read + write the workspace's tier-routing matrix (`workspaces.tier_routing`
 * jsonb, migration 033). The matrix maps the three customer-visible tier
 * keys (small / medium / large — surfaced in the dashboard as Lite /
 * Standard / Power) onto a `{provider, model}` binding from one of the
 * workspace's connected LLM credentials.
 *
 * The internal `vision` and `embeddings` tier keys are derived from the
 * customer-visible matrix on read (see tierRouter's downstream consumers)
 * rather than exposed for direct configuration — the dashboard intentionally
 * hides them to keep the surface to "the three tiers the operator picks
 * agents for."
 *
 * Validation rules:
 *   - Each (provider, model) pair must be valid per PROVIDER_MODELS.
 *   - The workspace must have at least one LLM credential for the binding's
 *     provider — aspirational settings (point a tier at a provider the user
 *     has never connected) are rejected because every routing call to that
 *     tier would fall back to auto-derivation anyway. Cleaner to require
 *     the credential first.
 *
 * RBAC: same as /api/llm-credentials — admin + developer. Operators can't
 * change the tier matrix because it's a workspace-wide cost/quality lever.
 */

import { Router, type Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  TIER_KEYS,
  type TierBinding,
  type TierKey,
  type TierMatrix,
  getWorkspaceTierMatrix,
  setWorkspaceTierMatrix,
} from "./tierRouter";
import { llmConfigStore } from "./llmConfigStore";
import {
  PROVIDER_NAMES,
  type ProviderName,
} from "../engine/llmProviders/types";
import { asyncHandler } from "../middleware/asyncHandler";

const PROVIDER_SET = new Set<ProviderName>(PROVIDER_NAMES);

// The three keys the dashboard surfaces. `vision` + `embeddings` are
// auto-derived from these.
const CUSTOMER_TIER_KEYS: ReadonlyArray<TierKey> = ["small", "medium", "large"];

interface BindingValidationResult {
  ok: boolean;
  error?: string;
}

function isValidBinding(
  raw: unknown,
): raw is { provider: ProviderName; model: string } {
  if (!raw || typeof raw !== "object") return false;
  const b = raw as { provider?: unknown; model?: unknown };
  if (typeof b.provider !== "string" || typeof b.model !== "string") return false;
  if (!PROVIDER_SET.has(b.provider as ProviderName)) return false;
  if (b.model.trim().length === 0) return false;
  return true;
}

function validateMatrixShape(raw: unknown): {
  matrix: TierMatrix;
  error?: string;
} {
  if (raw === null || raw === undefined) {
    return { matrix: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { matrix: {}, error: "matrix must be an object keyed by tier" };
  }
  const out: TierMatrix = {};
  for (const [key, binding] of Object.entries(raw as Record<string, unknown>)) {
    if (!CUSTOMER_TIER_KEYS.includes(key as TierKey)) {
      return {
        matrix: {},
        error: `unsupported tier key "${key}" — only ${CUSTOMER_TIER_KEYS.join(", ")} are user-configurable`,
      };
    }
    if (binding === null) {
      // Explicit null clears the tier — fall back to auto-derivation.
      continue;
    }
    if (!isValidBinding(binding)) {
      return {
        matrix: {},
        error: `tier "${key}" binding must be { provider, model } with a known provider`,
      };
    }
    out[key as TierKey] = {
      provider: (binding as TierBinding).provider,
      model: (binding as TierBinding).model.trim(),
    };
  }
  return { matrix: out };
}

function validateAgainstConnections(
  matrix: TierMatrix,
  userConfigs: ReadonlyArray<{ provider: ProviderName }>,
): BindingValidationResult {
  const connectedProviders = new Set(userConfigs.map((c) => c.provider));
  for (const [tier, binding] of Object.entries(matrix)) {
    if (!binding) continue;
    if (!connectedProviders.has(binding.provider)) {
      return {
        ok: false,
        error: `Cannot route ${tier} tier to ${binding.provider}: no credential for that provider in this workspace. Connect ${binding.provider} first under the Models tab.`,
      };
    }
  }
  return { ok: true };
}

interface WorkspaceAwareReq extends AuthenticatedRequest {
  workspace?: { id: string };
}

export function createTierRoutingRoutes(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler<WorkspaceAwareReq>(async (req, res: Response) => {
      const workspaceId = req.workspace?.id;
      if (!workspaceId) {
        res.status(400).json({ error: "Workspace context required." });
        return;
      }
      const matrix = await getWorkspaceTierMatrix(workspaceId);
      // Project down to just the customer-visible tier keys. Vision +
      // embeddings derive from these on the consumer side.
      const projected: TierMatrix = {};
      for (const key of CUSTOMER_TIER_KEYS) {
        if (matrix[key]) projected[key] = matrix[key];
      }
      res.json({ matrix: projected });
    }),
  );

  router.patch(
    "/",
    asyncHandler<WorkspaceAwareReq>(async (req, res: Response) => {
      const workspaceId = req.workspace?.id;
      const userId = req.auth?.sub;
      if (!workspaceId || !userId) {
        res.status(400).json({ error: "Workspace + user context required." });
        return;
      }

      const body = req.body as { matrix?: unknown } | undefined;
      const shapeCheck = validateMatrixShape(body?.matrix);
      if (shapeCheck.error) {
        res.status(400).json({ error: shapeCheck.error });
        return;
      }

      const userConfigs = await llmConfigStore.listAsync(userId);
      const connectionCheck = validateAgainstConnections(
        shapeCheck.matrix,
        userConfigs.map((c) => ({ provider: c.provider as ProviderName })),
      );
      if (!connectionCheck.ok) {
        res.status(400).json({ error: connectionCheck.error });
        return;
      }

      await setWorkspaceTierMatrix(workspaceId, shapeCheck.matrix);
      res.json({ matrix: shapeCheck.matrix });
    }),
  );

  return router;
}

// Default export so callers can match the llmConfigRoutes mount style.
export default createTierRoutingRoutes();

// Surface the constant so the dashboard can keep the surface in sync.
export { CUSTOMER_TIER_KEYS };
// Re-export TIER_KEYS for tests that want to verify we filter correctly.
export { TIER_KEYS };
