import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../../context/AuthContext";
import {
  downloadLedgerCsv,
  formatCredits,
  getWalletBalance,
  type WalletBalance,
} from "../../api/creditsApi";
import { BuyCreditPackModal } from "./BuyCreditPackModal";

/**
 * Billing-page credits card. Reads /api/credits/wallet/balance and shows
 * current balance + lifetime totals. The Buy button opens the pack
 * picker; Stripe takes the user away from the dashboard, and they
 * come back to /billing/credits/success which calls the confirm endpoint
 * to grant credits before redirecting back here.
 */
export function CreditsPanel() {
  const { requireAccessToken } = useAuth();
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const token = await requireAccessToken();
      await downloadLedgerCsv(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export ledger");
    } finally {
      setExporting(false);
    }
  }, [requireAccessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const balance = await getWalletBalance(token);
      setWallet(balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load wallet");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const balance = wallet?.balanceCredits ?? "0";
  const purchased = wallet?.lifetimePurchasedCredits ?? "0";
  const consumed = wallet?.lifetimeConsumedCredits ?? "0";

  return (
    <>
      <div className="card">
        <h3>Hosted credits</h3>
        <p className="desc" style={{ marginTop: 4 }}>
          Pay-as-you-go inference. Routes through any of our hosted models — pick a tier in
          tier routing, we handle the provider.
        </p>
        {loading ? (
          <p className="desc" style={{ marginTop: 12 }}>Loading balance…</p>
        ) : error ? (
          <>
            <p className="desc" style={{ marginTop: 12, color: "var(--af2-clay)" }}>{error}</p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => void load()}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                fontFamily: "var(--af2-serif)",
                fontSize: 32,
                lineHeight: 1,
                marginTop: 12,
              }}
              data-testid="credits-balance"
            >
              {formatCredits(balance)}
            </div>
            <div className="desc" style={{ marginTop: 4 }}>
              credits available · {formatCredits(purchased)} purchased · {formatCredits(consumed)} used
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => setBuyOpen(true)}
            disabled={loading}
          >
            Buy a credit pack
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleExport()}
            disabled={loading || exporting}
            title="Download the full ledger as CSV for accounting / reconciliation"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
      <BuyCreditPackModal
        open={buyOpen}
        onClose={() => {
          setBuyOpen(false);
          // If the user closed without buying, balance is unchanged. If
          // they did buy, Stripe redirected away — we won't reach here.
        }}
      />
    </>
  );
}
