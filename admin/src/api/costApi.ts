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

export interface InfraCost {
  openrouter: OpenRouterSpendSummary;
  fly: FlySpendSummary;
  cloudflare: CloudflareActivitySummary;
  supabase: SupabaseLinks;
}

export async function fetchInfraCost(): Promise<InfraCost> {
  return apiRequest<InfraCost>("/api/admin-console/infra/cost");
}
