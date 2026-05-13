import { useCallback } from "react";
import { EntitlementError, type EntitlementErrorPayload } from "../api/entitlementError";

export interface Entitlement402State {
  feature: string;
  currentTier: string;
  upgradeTo: string | null;
  limit: number | boolean;
  current?: number;
  /** Opens the upgrade flow (billing checkout or contact-sales mailto). */
  openUpgrade: () => void;
}

/**
 * Parses an error thrown by an API client call and returns upgrade-CTA state
 * when the error is a 402 entitlement_exceeded response, or null otherwise.
 *
 * Usage:
 *   const entitlement = useEntitlement402();
 *   // ...
 *   try { await createLLMConfig(...) }
 *   catch (err) {
 *     const state = entitlement.parse(err);
 *     if (state) { setUpgradeState(state); return; }
 *     setError(String(err));
 *   }
 */
export function useEntitlement402() {
  const parse = useCallback((err: unknown): Entitlement402State | null => {
    if (!EntitlementError.isEntitlementError(err)) return null;
    const p: EntitlementErrorPayload = err.payload;

    const openUpgrade = () => {
      if (!p.upgradeTo) {
        window.location.href = "mailto:sales@helloautoflow.com?subject=AutoFlow%20Scale%20Plan";
        return;
      }
      window.location.href = `/pricing?tier=${encodeURIComponent(p.upgradeTo)}`;
    };

    return {
      feature: p.feature,
      currentTier: p.currentTier,
      upgradeTo: p.upgradeTo,
      limit: p.limit,
      current: p.current,
      openUpgrade,
    };
  }, []);

  return { parse };
}
