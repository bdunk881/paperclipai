import { useQuery } from "@tanstack/react-query";
import { getPricing, type Pricing, type PricingTier } from "../api/pricingApi";

export function usePricing(): {
  tiers: PricingTier[] | null;
  pricing: Pricing | null;
  loading: boolean;
} {
  const query = useQuery({
    queryKey: ["pricing"] as const,
    queryFn: getPricing,
    // Pricing rarely changes mid-session; 5 minutes matches the API's
    // s-maxage header and the entitlements query staleTime.
    staleTime: 5 * 60_000,
  });

  return {
    tiers: query.data?.tiers ?? null,
    pricing: query.data ?? null,
    loading: query.isLoading,
  };
}
