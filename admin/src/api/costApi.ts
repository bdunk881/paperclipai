import { apiRequest } from "../lib/apiClient";

export interface SpendWindow {
  hours: number;
  spend_usd: number;
}

export interface OpenRouterSpendSummary {
  configured: boolean;
  prepaid_balance_usd: number | null;
  prepaid_balance_observed_at: string | null;
  trailing_24h: SpendWindow;
  trailing_7d: SpendWindow;
  trailing_30d: SpendWindow;
  projected_daily_usd: number;
  projected_monthly_usd: number;
}

export interface FlySpendSummary {
  configured: boolean;
  total_machines: number;
  by_app: Array<{ app: string; machines: number; regions: string[] }>;
}

export interface CloudflareActivitySummary {
  configured: boolean;
  project_count: number;
  recent_deploys_total: number;
}

export interface SupabaseLinks {
  configured: boolean;
  billing_url: string | null;
}

export type CostMetric = "openrouter";
export type CostBucket =
  | "trailing_24h"
  | "trailing_7d"
  | "trailing_30d"
  | "projected_daily"
  | "projected_monthly"
  | "balance_runway_days";

export interface CostThreshold {
  id: string;
  metric: CostMetric;
  bucket: CostBucket;
  ceiling_value: number;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

export interface BreachStatus {
  threshold_id: string;
  metric: CostMetric;
  bucket: CostBucket;
  ceiling_value: number;
  observed_value: number | null;
  breached: boolean;
  direction: "above_ceiling_breaches" | "below_ceiling_breaches";
  note: string | null;
}

export interface InfraCost {
  openrouter: OpenRouterSpendSummary;
  fly: FlySpendSummary;
  cloudflare: CloudflareActivitySummary;
  supabase: SupabaseLinks;
  thresholds: CostThreshold[];
  breaches: BreachStatus[];
}

export async function fetchInfraCost(): Promise<InfraCost> {
  return apiRequest<InfraCost>("/api/admin-console/infra/cost");
}

export async function createCostThreshold(input: {
  metric: CostMetric;
  bucket: CostBucket;
  ceilingValue: number;
  note?: string | null;
  reason: string;
}): Promise<CostThreshold> {
  const res = await apiRequest<{ threshold: CostThreshold }>(
    "/api/admin-console/infra/cost/thresholds",
    {
      method: "POST",
      body: {
        metric: input.metric,
        bucket: input.bucket,
        ceiling_value: input.ceilingValue,
        note: input.note ?? null,
        reason: input.reason,
      },
    },
  );
  return res.threshold;
}

export async function updateCostThreshold(input: {
  id: string;
  ceilingValue?: number;
  note?: string | null;
  reason: string;
}): Promise<CostThreshold> {
  const body: Record<string, unknown> = { reason: input.reason };
  if (input.ceilingValue !== undefined) body.ceiling_value = input.ceilingValue;
  if (input.note !== undefined) body.note = input.note;
  const res = await apiRequest<{ threshold: CostThreshold }>(
    `/api/admin-console/infra/cost/thresholds/${encodeURIComponent(input.id)}`,
    { method: "PATCH", body },
  );
  return res.threshold;
}

export async function disableCostThreshold(input: { id: string; reason: string }): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/cost/thresholds/${encodeURIComponent(input.id)}`,
    { method: "DELETE", body: { reason: input.reason } },
  );
}
