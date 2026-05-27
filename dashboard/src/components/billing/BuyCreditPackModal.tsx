import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";
import { Af2Modal } from "../af2/Af2Modal";
import {
  formatCredits,
  formatUsd,
  listCreditPacks,
  startCreditPackCheckout,
  type CreditPack,
} from "../../api/creditsApi";

interface BuyCreditPackModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Lists the credit packs from /api/credits/checkout/packs and starts a
 * Stripe Checkout session on click. Stripe redirects the buyer to
 * /billing/credits/success which calls /api/credits/checkout/confirm to
 * grant credits immediately (the webhook fires a redundant grant later,
 * deduped by stripe_session_id in credit_purchase_events).
 */
export function BuyCreditPackModal({ open, onClose }: BuyCreditPackModalProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const token = await requireAccessToken();
        const list = await listCreditPacks(token);
        if (!cancelled) setPacks(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load credit packs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, requireAccessToken]);

  const handleBuy = useCallback(
    async (pack: CreditPack) => {
      setPendingPackId(pack.id);
      try {
        const token = await requireAccessToken();
        const url = await startCreditPackCheckout(token, pack.id);
        window.location.href = url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start checkout");
        setPendingPackId(null);
      }
    },
    [requireAccessToken, toast],
  );

  return (
    <Af2Modal
      open={open}
      onClose={onClose}
      eyebrow="Hosted credits"
      title="Buy a credit pack"
      maxWidth={620}
      dismissOnBackdrop={pendingPackId == null}
      footer={
        <div className="af2-row" style={{ width: "100%" }}>
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            onClick={onClose}
            disabled={pendingPackId != null}
          >
            Close
          </button>
          <span className="af2-spacer" />
          <p className="desc" style={{ margin: 0, fontSize: 12 }}>
            Credits never expire for the first 12 months · usage applied across all hosted models
          </p>
        </div>
      }
    >
      {loading ? (
        <p className="desc">Loading packs…</p>
      ) : error ? (
        <p className="desc" style={{ color: "var(--af2-clay)" }}>{error}</p>
      ) : packs && packs.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          {packs.map((pack) => {
            const bonus = pack.bonusPercent > 0 ? ` · +${pack.bonusPercent}% bonus` : "";
            const submitting = pendingPackId === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                className="card"
                onClick={() => void handleBuy(pack)}
                disabled={pendingPackId != null}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 14,
                  cursor: pendingPackId != null ? "not-allowed" : "pointer",
                  textAlign: "left",
                  border: "1px solid var(--af2-border, rgba(0,0,0,0.12))",
                  background: "var(--af2-paper, #fff)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{pack.displayName}</div>
                  <div className="desc" style={{ marginTop: 2 }}>
                    {formatCredits(pack.creditsGranted)} credits{bonus}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontFamily: "var(--af2-serif)", fontSize: 22 }}>
                    {formatUsd(pack.priceUsdCents)}
                  </div>
                  <span className="btn primary" aria-hidden>
                    {submitting ? "Redirecting…" : "Buy"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="desc">No credit packs are available right now. Check back soon.</p>
      )}
    </Af2Modal>
  );
}
