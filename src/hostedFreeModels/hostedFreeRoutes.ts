/**
 * GET /api/hosted-free-models — public catalog of the hosted free tiers
 * AutoFlow offers for Explore workspaces (PR B.1).
 *
 * Lightweight: returns the static catalog from providers.ts + a
 * per-provider `available` flag derived from whether the env var key
 * is configured in this environment. Dashboard reads this to render
 * the LLM Providers page's hosted-free section (PR B.3) + to surface
 * which tiers are actually live in dev/preview/prod (the env keys may
 * not be set in every environment, especially in CI).
 *
 * No per-workspace usage / token cap data here yet — that lands with
 * PR B.2. Mounted under requireAuth so anonymous users can't probe.
 */

import { Router, type Request, type Response } from "express";
import {
  DEFAULT_HOSTED_FREE_PROVIDER_ID,
  HOSTED_FREE_PROVIDERS,
  resolveHostedFreeApiKey,
} from "./providers";

export interface HostedFreeProviderResponse {
  id: string;
  tier: number;
  label: string;
  description: string;
  provider: string;
  modelId: string;
  warnings: string[];
  available: boolean;
  isDefault: boolean;
}

export function createHostedFreeRoutes(): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    const providers: HostedFreeProviderResponse[] = HOSTED_FREE_PROVIDERS.map((p) => ({
      id: p.id,
      tier: p.tier,
      label: p.label,
      description: p.description,
      provider: p.provider,
      modelId: p.modelId,
      warnings: p.warnings,
      available: resolveHostedFreeApiKey(p) !== null,
      isDefault: p.id === DEFAULT_HOSTED_FREE_PROVIDER_ID,
    }));
    res.json({
      providers,
      defaultProviderId: DEFAULT_HOSTED_FREE_PROVIDER_ID,
    });
  });

  return router;
}
