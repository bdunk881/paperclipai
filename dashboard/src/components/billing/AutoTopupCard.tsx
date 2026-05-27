import { useCallback, useEffect, useState } from "react";

import {
  formatCredits,
  patchAutoTopupConfig,
  startAutoTopupSetupCheckout,
  type WalletBalance,
} from "../../api/creditsApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";

interface AutoTopupCardProps {
  wallet: WalletBalance | null;
  onSaved: () => void;
}

/**
 * Auto-topup configuration card on the Billing page. Three states:
 *   - No card on file → primary CTA is "Add a card via Stripe Checkout"
 *     which redirects to Stripe's hosted Setup mode (no Stripe.js
 *     dependency in the dashboard).
 *   - Card on file, auto-topup disabled → toggle to enable + configure.
 *   - Auto-topup enabled → show current config + edit / disable.
 *
 * The card-on-file state is inferred from the backend wallet payload:
 * when auto-topup has ever been enabled, the wallet must have had IDs
 * populated. The dashboard does NOT receive the raw Stripe IDs (no
 * reason to expose them client-side); the backend just returns enabled
 * + thresholds.
 */
export function AutoTopupCard({ wallet, onSaved }: AutoTopupCardProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const enabled = wallet?.autoTopupEnabled ?? false;

  const [triggerInput, setTriggerInput] = useState<string>(
    wallet?.autoTopupTriggerCredits ?? "100000",
  );
  const [amountInput, setAmountInput] = useState<string>(
    wallet?.autoTopupAmountCredits ?? "500000",
  );
  const [saving, setSaving] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    // When the wallet payload arrives or updates, seed the inputs from
    // the server values so the form reflects truth.
    if (wallet?.autoTopupTriggerCredits) setTriggerInput(wallet.autoTopupTriggerCredits);
    if (wallet?.autoTopupAmountCredits) setAmountInput(wallet.autoTopupAmountCredits);
  }, [wallet?.autoTopupTriggerCredits, wallet?.autoTopupAmountCredits]);

  const handleAddCard = useCallback(async () => {
    setRedirecting(true);
    try {
      const token = await requireAccessToken();
      const url = await startAutoTopupSetupCheckout(token);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start setup checkout");
      setRedirecting(false);
    }
  }, [requireAccessToken, toast]);

  const handleSave = useCallback(
    async (nextEnabled: boolean) => {
      setSaving(true);
      try {
        const token = await requireAccessToken();
        await patchAutoTopupConfig(token, {
          enabled: nextEnabled,
          triggerCredits: nextEnabled ? triggerInput : undefined,
          amountCredits: nextEnabled ? amountInput : undefined,
        });
        toast.success(nextEnabled ? "Auto-topup updated" : "Auto-topup disabled");
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update auto-topup");
      } finally {
        setSaving(false);
      }
    },
    [requireAccessToken, triggerInput, amountInput, toast, onSaved],
  );

  return (
    <div className="card">
      <h3>Auto-topup</h3>
      <p className="desc" style={{ marginTop: 4 }}>
        Keep credits topped up automatically. We charge your saved card when the balance dips
        below the trigger.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="desc" style={{ fontSize: 12 }}>
            Trigger (top up when balance drops below):
          </span>
          <input
            type="number"
            min={1000}
            step={1000}
            value={triggerInput}
            onChange={(e) => setTriggerInput(e.target.value)}
            className="input"
            style={{ padding: 6 }}
            disabled={saving || redirecting}
          />
          <span className="desc" style={{ fontSize: 11 }}>
            ≈ {formatCredits(triggerInput)} credits — minimum 1,000
          </span>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span className="desc" style={{ fontSize: 12 }}>
            Top up amount:
          </span>
          <input
            type="number"
            min={10_000}
            max={10_000_000}
            step={10_000}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="input"
            style={{ padding: 6 }}
            disabled={saving || redirecting}
          />
          <span className="desc" style={{ fontSize: 11 }}>
            ≈ {formatCredits(amountInput)} credits per top-up · max 10M ($1,000)
          </span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void handleAddCard()}
          disabled={saving || redirecting}
          title="Stripe collects your card details — we never see them"
        >
          {redirecting ? "Redirecting…" : "Add / replace card via Stripe"}
        </button>
        {enabled ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void handleSave(true)}
              disabled={saving || redirecting}
            >
              {saving ? "Saving…" : "Update config"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleSave(false)}
              disabled={saving || redirecting}
              style={{ marginLeft: "auto" }}
            >
              Disable auto-topup
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => void handleSave(true)}
            disabled={saving || redirecting}
          >
            {saving ? "Enabling…" : "Enable auto-topup"}
          </button>
        )}
      </div>

      <p className="desc" style={{ marginTop: 10, fontSize: 11 }}>
        Status:{" "}
        <strong style={{ color: enabled ? "var(--af2-sage)" : "var(--af2-ink-2)" }}>
          {enabled ? "ON" : "OFF"}
        </strong>{" "}
        · Your card details stay with Stripe. If a top-up charge fails, we disable auto-topup
        and email you.
      </p>
    </div>
  );
}
