/**
 * GET /api/hosted-free-models — catalog of the hosted free tiers
 * AutoFlow offers for Explore workspaces (PR B.1) plus per-workspace
 * daily token usage (PR B.2).
 *
 * Lightweight: returns the static catalog from providers.ts + a
 * per-provider `available` flag derived from whether the env var key
 * is configured in this environment. When the request has a
 * workspace context (via workspaceResolver), the response also
 * includes the workspace's current daily token usage so the dashboard
 * can render the usage badge + the at-cap warning.
 *
 * Mounted under requireAuth + workspaceResolver so anonymous users
 * can't probe and the usage snapshot reflects the active workspace.
 */

import { Router, type Request, type Response } from "express";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  DEFAULT_HOSTED_FREE_PROVIDER_ID,
  HOSTED_FREE_PROVIDERS,
  resolveHostedFreeApiKey,
} from "./providers";
import { getHostedFreeUsage } from "./usageStore";

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

export interface HostedFreeCatalogResponse {
  providers: HostedFreeProviderResponse[];
  defaultProviderId: string;
  usage: {
    workspaceId: string | null;
    dayKey: string | null;
    usedTokens: number;
    capTokens: number;
    remainingTokens: number;
    warning: boolean;
    exceeded: boolean;
  };
}

export function createHostedFreeRoutes(): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
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
    // workspaceResolver mounts at the app layer when the dashboard is
    // signed in to an active workspace; on the rare path where it
    // doesn't run (anonymous probes can't get here past requireAuth,
    // but defensive), surface a zeroed usage snapshot.
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id ?? null;
    const usage = workspaceId
      ? getHostedFreeUsage(workspaceId)
      : null;
    const response: HostedFreeCatalogResponse = {
      providers,
      defaultProviderId: DEFAULT_HOSTED_FREE_PROVIDER_ID,
      usage: usage
        ? {
            workspaceId: usage.workspaceId,
            dayKey: usage.dayKey,
            usedTokens: usage.usedTokens,
            capTokens: usage.capTokens,
            remainingTokens: usage.remainingTokens,
            warning: usage.warning,
            exceeded: usage.exceeded,
          }
        : {
            workspaceId: null,
            dayKey: null,
            usedTokens: 0,
            capTokens: 0,
            remainingTokens: 0,
            warning: false,
            exceeded: false,
          },
    };
    res.json(response);
  });

  return router;
}
